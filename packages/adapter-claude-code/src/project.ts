import { basename, dirname } from 'node:path';
import type { Project, ScoutFs } from '@scout/core';

export type ProjectIdentityMode = 'repo' | 'cwd';

export type ResolveProjectInput = {
  cwd: string;
  /** A remote URL already known to the harness; preferred over the fs walk. */
  remoteHint?: string;
  repoRootHint?: string;
};

export type ResolveProjectOptions = { fs: ScoutFs; mode?: ProjectIdentityMode };

/**
 * Normalizes `git@host:org/repo.git` and `https://host/org/repo.git` (and
 * similar variants) to `host/org/repo` (docs/ARCHITECTURE.md §3 Project.key).
 * Moved from packages/core/src/project/resolve.ts (plan.md P18, f2-t2):
 * project identity resolution is adapter-owned now, using ctx.fs only.
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
  fs: ScoutFs,
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

async function readOriginRemote(repoRoot: string, fs: ScoutFs): Promise<string | undefined> {
  const config = await fs.readFile(`${repoRoot}/.git/config`);
  if (!config) return undefined;
  const sectionMatch = config.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/);
  const section = sectionMatch?.[1] ?? config;
  const urlMatch = section.match(/^\s*url\s*=\s*(.+)\s*$/m);
  return urlMatch?.[1]?.trim();
}

/**
 * Resolves a project grouping key from a session's cwd, per
 * docs/ARCHITECTURE.md §3/§4 (D8/D9). Harness-provided git facts
 * (`remoteHint`, `repoRootHint`) are used first; the filesystem walk only
 * fills gaps. Retyped to the contract `Project` (f2-t2); logic unchanged
 * from the legacy `packages/core/src/project/resolve.ts`.
 */
export async function resolveProject(
  input: ResolveProjectInput,
  opts: ResolveProjectOptions,
): Promise<Project> {
  const mode: ProjectIdentityMode = opts.mode ?? 'repo';

  if (mode === 'cwd') {
    return { key: input.cwd, name: basename(input.cwd), identity: 'cwd' };
  }

  let repoRoot = input.repoRootHint;
  let worktree: string | undefined;
  if (!repoRoot) {
    const found = await findGitRoot(input.cwd, opts.fs);
    repoRoot = found?.repoRoot;
    worktree = found?.worktree;
  }

  let remote = input.remoteHint;
  if (!remote && repoRoot) {
    remote = await readOriginRemote(repoRoot, opts.fs);
  }

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
