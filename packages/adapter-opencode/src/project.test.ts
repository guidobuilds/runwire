import { describe, expect, test } from 'bun:test';
import { createMemoryFs } from '@runwire/core';
import { normalizeRemoteUrl, resolveOpencodeProject } from './project';

describe('normalizeRemoteUrl', () => {
  test('normalizes scp, https and trailing-variants to host/org/repo', () => {
    expect(normalizeRemoteUrl('git@host:org/repo.git')).toBe('host/org/repo');
    expect(normalizeRemoteUrl('https://host/org/repo.git')).toBe('host/org/repo');
    expect(normalizeRemoteUrl('https://host/org/repo')).toBe('host/org/repo');
    expect(normalizeRemoteUrl('  git@host:org/repo.git  ')).toBe('host/org/repo');
  });

  test('returns undefined for unusable input', () => {
    expect(normalizeRemoteUrl('')).toBeUndefined();
    expect(normalizeRemoteUrl('not a url')).toBeUndefined();
  });
});

describe('resolveOpencodeProject', () => {
  test('uses the project worktree as repoRootHint and falls back to repo-root identity when no remote exists', async () => {
    const project = await resolveOpencodeProject(
      { cwd: '/home/u/proj', repoRootHint: '/home/u/proj' },
      { fs: createMemoryFs() },
    );
    expect(project.key).toBe('/home/u/proj');
    expect(project.name).toBe('proj');
    expect(project.repoRoot).toBe('/home/u/proj');
    expect(project.identity).toBe('repo-root');
  });

  test('with no worktree hint and no git repo on disk, falls back to cwd identity', async () => {
    const project = await resolveOpencodeProject({ cwd: '/home/u/proj' }, { fs: createMemoryFs() });
    expect(project.key).toBe('/home/u/proj');
    expect(project.identity).toBe('cwd');
  });

  test('reads a remote from the worktree .git/config when present', async () => {
    const fs = createMemoryFs({
      files: {
        '/home/u/proj/.git/config': '[remote "origin"]\n\turl = git@github.com:acme/proj.git\n',
      },
    });
    const project = await resolveOpencodeProject(
      { cwd: '/home/u/proj', repoRootHint: '/home/u/proj' },
      { fs },
    );
    expect(project.key).toBe('github.com/acme/proj');
    expect(project.identity).toBe('remote');
  });
});
