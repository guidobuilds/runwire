import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBunFs, createMemoryFs } from '@runwire/core';
import { normalizeRemoteUrl, resolveProject } from './project';

describe('normalizeRemoteUrl', () => {
  test.each([
    ['git@github.com:org/repo.git', 'github.com/org/repo'],
    ['https://github.com/org/repo.git', 'github.com/org/repo'],
    ['https://github.com/org/repo', 'github.com/org/repo'],
    ['https://gitlab.com/group/sub/repo.git', 'gitlab.com/group/sub/repo'],
    ['ssh://git@host.xz/org/repo.git', 'host.xz/org/repo'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRemoteUrl(input)).toBe(expected);
  });

  test('an unparseable value normalizes to undefined', () => {
    expect(normalizeRemoteUrl('not a url at all')).toBeUndefined();
  });
});

describe('resolveProject - real filesystem', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'runwire-adapter-project-test-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('a repo with an origin remote resolves by normalized remote URL', async () => {
    const repo = join(root, 'repo-with-remote');
    await mkdir(join(repo, '.git'), { recursive: true });
    await writeFile(
      join(repo, '.git', 'config'),
      '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    );

    const fs = createBunFs();
    const p = await resolveProject({ cwd: repo }, { fs });
    expect(p.identity).toBe('remote');
    expect(p.key).toBe('github.com/acme/widgets');
    expect(p.name).toBe('widgets');
    expect(p.repoRoot).toBe(repo);
  });

  test('resolves from a nested working directory by walking up to the repo root', async () => {
    const repo = join(root, 'repo-nested');
    const nested = join(repo, 'src', 'features', 'x');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(repo, '.git', 'config'),
      '[remote "origin"]\n\turl = https://example.com/team/app.git\n',
    );

    const fs = createBunFs();
    const p = await resolveProject({ cwd: nested }, { fs });
    expect(p.key).toBe('example.com/team/app');
    expect(p.repoRoot).toBe(repo);
  });

  test('a repo with no remote falls back to the repo root as the key', async () => {
    const repo = join(root, 'repo-no-remote');
    await mkdir(join(repo, '.git'), { recursive: true });

    const fs = createBunFs();
    const p = await resolveProject({ cwd: repo }, { fs });
    expect(p.identity).toBe('repo-root');
    expect(p.key).toBe(repo);
    expect(p.name).toBe('repo-no-remote');
  });

  test('a linked worktree resolves repoRoot and worktree name from the .git file, and reads the main repo remote', async () => {
    const main = join(root, 'main-repo');
    await mkdir(join(main, '.git', 'worktrees', 'feature-x'), { recursive: true });
    await writeFile(
      join(main, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:acme/main.git\n',
    );

    const worktree = join(root, 'main-repo-feature-x');
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, '.git'), `gitdir: ${main}/.git/worktrees/feature-x\n`);

    const fs = createBunFs();
    const p = await resolveProject({ cwd: worktree }, { fs });
    expect(p.repoRoot).toBe(main);
    expect(p.worktree).toBe('feature-x');
    expect(p.key).toBe('github.com/acme/main');
  });

  test('no .git anywhere up to the filesystem root falls back to cwd identity', async () => {
    const noGit = join(root, 'plain-dir');
    await mkdir(noGit, { recursive: true });

    const fs = createBunFs();
    const p = await resolveProject({ cwd: noGit }, { fs });
    expect(p.identity).toBe('cwd');
    expect(p.key).toBe(noGit);
  });
});

describe('resolveProject - hints and mode', () => {
  test('a harness-provided remoteHint is used without touching the filesystem', async () => {
    const fs = createMemoryFs();
    const p = await resolveProject(
      { cwd: '/home/u/proj', remoteHint: 'git@github.com:acme/hinted.git' },
      { fs },
    );
    expect(p.identity).toBe('remote');
    expect(p.key).toBe('github.com/acme/hinted');
  });

  test('a harness-provided repoRootHint skips the fs walk for repoRoot but a remote is still read from it', async () => {
    const fs = createMemoryFs({
      files: {
        '/hinted/root/.git/config': '[remote "origin"]\n\turl = https://example.com/a/b.git\n',
      },
    });
    const p = await resolveProject(
      { cwd: '/somewhere/else', repoRootHint: '/hinted/root' },
      { fs },
    );
    expect(p.repoRoot).toBe('/hinted/root');
    expect(p.key).toBe('example.com/a/b');
  });

  test('mode "cwd" short-circuits entirely, ignoring hints and the filesystem', async () => {
    const fs = createMemoryFs();
    const p = await resolveProject(
      { cwd: '/home/u/proj', remoteHint: 'git@github.com:acme/ignored.git' },
      { fs, mode: 'cwd' },
    );
    expect(p.identity).toBe('cwd');
    expect(p.key).toBe('/home/u/proj');
  });
});
