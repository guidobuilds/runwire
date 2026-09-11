import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '@scout/core';
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

describe('resolveProject - memory fs', () => {
  test('a repo with an origin remote resolves by normalized remote URL', async () => {
    const fs = createMemoryFs({
      files: {
        '/repo-with-remote/.git/config':
          '[remote "origin"]\n\turl = git@github.com:acme/widgets.git\n',
      },
    });
    const p = await resolveProject({ cwd: '/repo-with-remote' }, { fs });
    expect(p.identity).toBe('remote');
    expect(p.key).toBe('github.com/acme/widgets');
    expect(p.name).toBe('widgets');
    expect(p.repoRoot).toBe('/repo-with-remote');
  });

  test('resolves from a nested working directory by walking up to the repo root', async () => {
    const fs = createMemoryFs({
      files: {
        '/repo-nested/.git/config': '[remote "origin"]\n\turl = https://example.com/team/app.git\n',
      },
    });
    const p = await resolveProject({ cwd: '/repo-nested/src/features/x' }, { fs });
    expect(p.key).toBe('example.com/team/app');
    expect(p.repoRoot).toBe('/repo-nested');
  });

  test('a repo with no origin remote falls back to the repo root as the key', async () => {
    const fs = createMemoryFs({ files: { '/repo-no-remote/.git/HEAD': 'ref: refs/heads/main\n' } });
    const p = await resolveProject({ cwd: '/repo-no-remote' }, { fs });
    expect(p.identity).toBe('repo-root');
    expect(p.key).toBe('/repo-no-remote');
    expect(p.name).toBe('repo-no-remote');
  });

  test('a linked worktree resolves repoRoot and worktree name from the .git file', async () => {
    const fs = createMemoryFs({
      files: {
        '/main-repo/.git/config': '[remote "origin"]\n\turl = git@github.com:acme/main.git\n',
        '/main-repo-feature-x/.git': 'gitdir: /main-repo/.git/worktrees/feature-x\n',
      },
    });
    const p = await resolveProject({ cwd: '/main-repo-feature-x' }, { fs });
    expect(p.repoRoot).toBe('/main-repo');
    expect(p.worktree).toBe('feature-x');
    expect(p.key).toBe('github.com/acme/main');
  });

  test('no .git anywhere up to the filesystem root falls back to cwd identity', async () => {
    const fs = createMemoryFs();
    const p = await resolveProject({ cwd: '/plain-dir' }, { fs });
    expect(p.identity).toBe('cwd');
    expect(p.key).toBe('/plain-dir');
  });

  test('mode "cwd" short-circuits entirely, ignoring the filesystem', async () => {
    const fs = createMemoryFs({
      files: {
        '/x/.git/config': '[remote "origin"]\n\turl = git@github.com:acme/ignored.git\n',
      },
    });
    const p = await resolveProject({ cwd: '/x' }, { fs, mode: 'cwd' });
    expect(p.identity).toBe('cwd');
    expect(p.key).toBe('/x');
  });
});
