import { basename, dirname } from 'node:path';
import type { Project, RunwireFs } from '@runwire/core';

export type OpenCodeResolveInput = {
  /** The session's `directory` (cwd). */
  cwd: string;
  /** The project's `worktree` (repo root), when present. */
  repoRootHint?: string;
};

export type OpenCodeResolveOptions = { fs: RunwireFs };

/**
 * Normalizes `git@host:org/repo.git` and `https://host/org/repo.git` (and
 * similar variants) to `host/org/repo` (docs/ARCHITECTURE.md §3 Project.key).
 * Re-implemented here (not imported from @runwire/adapter-claude-code) so this
 * package depends on @runwire/core only, and so the same repo rolls up to the
 * same key as the Claude adapter.
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
 * Resolves the OpenCode project grouping key from a session's `directory`
 * (cwd) and the project's `worktree` (repo root), per docs/ARCHITECTURE.md
 * §3/§4 (D8/D9). A null/absent `worktree` (5/9 projects have `vcs` NULL)
 * falls back to the cwd. `project.key` must equal `session.projectKey`.
 */
export async function resolveOpencodeProject(
  input: OpenCodeResolveInput,
  opts: OpenCodeResolveOptions,
): Promise<Project> {
  let repoRoot = input.repoRootHint;
  let worktree: string | undefined;
  if (!repoRoot) {
    const found = await findGitRoot(input.cwd, opts.fs);
    repoRoot = found?.repoRoot;
    worktree = found?.worktree;
  }

  let remote: string | undefined;
  if (repoRoot) {
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
