import { basename, dirname } from 'node:path';
import type { Project, RunwireFs } from '@runwire/core';

export type ProjectIdentityMode = 'repo' | 'cwd';

export type ResolveProjectInput = {
  cwd: string;
};

export type ResolveProjectOptions = { fs: RunwireFs; mode?: ProjectIdentityMode };

/**
 * Normalizes `git@host:org/repo.git` and `https://host/org/repo.git` (and
 * similar variants) to `host/org/repo` (docs/ARCHITECTURE.md §3 Project.key).
 * Pi passes no remote hint, but `findGitRoot`'s discovered origin remote still
 * flows through this.
 */
export function normalizeRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim();
  let rest: string | undefined;

  const scpMatch = trimmed.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (scpMatch) {
    rest = `${scpMatch[1]}/${scpMatch[2]}`;
  } else {
    try {
      const u = new URL(trimmed);
      rest = `${u.host}${u.pathname}`;
    } catch {
      return undefined;
    }
  }

  rest = rest
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return rest.length > 0 ? rest : undefined;
}

async function findGitRoot(
  startCwd: string,
  fs: RunwireFs,
): Promise<{ repoRoot: string; worktree?: string } | undefined> {
  let dir = startCwd;
  for (let i = 0; i < 64; i++) {
    const gitPath = `${dir}/.git`;
    const stat = await fs.stat(gitPath);
    if (stat) {
      if (stat.isDirectory) return { repoRoot: dir };
      const content = await fs.readFile(gitPath);
      const match = content?.match(/gitdir:\s*(.+?)\/\.git\/worktrees\/([^/\s]+)\s*$/);
      if (match?.[1] && match[2]) return { repoRoot: match[1], worktree: match[2] };
      return { repoRoot: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

async function readOriginRemote(repoRoot: string, fs: RunwireFs): Promise<string | undefined> {
  const config = await fs.readFile(`${repoRoot}/.git/config`);
  if (!config) return undefined;
  const sectionMatch = config.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/);
  const section = sectionMatch?.[1] ?? config;
  const urlMatch = section.match(/^\s*url\s*=\s*(.+)\s*$/m);
  return urlMatch?.[1]?.trim();
}

/**
 * Resolves a project grouping key from a session's cwd, per
 * docs/ARCHITECTURE.md §3/§4 (D8/D9). Pi's stream carries no remote or repo-root
 * hint (docs/adapters/pi.md §3.2), so this is the pure filesystem walk.
 */
export async function resolveProject(
  input: ResolveProjectInput,
  opts: ResolveProjectOptions,
): Promise<Project> {
  const mode: ProjectIdentityMode = opts.mode ?? 'repo';

  if (mode === 'cwd') {
    return { key: input.cwd, name: basename(input.cwd), identity: 'cwd' };
  }

  const found = await findGitRoot(input.cwd, opts.fs);
  const repoRoot = found?.repoRoot;
  const worktree = found?.worktree;

  const remote = repoRoot ? await readOriginRemote(repoRoot, opts.fs) : undefined;

  const normalizedRemote = remote ? normalizeRemoteUrl(remote) : undefined;
  if (normalizedRemote) {
    return {
      key: normalizedRemote,
      name: basename(normalizedRemote),
      repoRoot,
      worktree,
      identity: 'remote',
    };
  }

  if (repoRoot) {
    return { key: repoRoot, name: basename(repoRoot), repoRoot, worktree, identity: 'repo-root' };
  }

  return { key: input.cwd, name: basename(input.cwd), identity: 'cwd' };
}
