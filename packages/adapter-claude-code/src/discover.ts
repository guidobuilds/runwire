import { join } from 'node:path';
import type { AdapterContext, SourceRef } from '@scout/core';
import {
  agentIdFromFile,
  isAgentFile,
  isIgnoredEntry,
  isRootSessionFile,
  projectsRoot,
  sessionIdFromRootFile,
} from './paths';

export async function probe(
  ctx: AdapterContext,
): Promise<{ installed: boolean; roots: string[]; notes: string[] }> {
  const root = projectsRoot(ctx);
  const stat = await ctx.fs.stat(root);
  if (!stat?.isDirectory) {
    return { installed: false, roots: [], notes: [`${root} not found`] };
  }
  return { installed: true, roots: [root], notes: [] };
}

export async function* discover(ctx: AdapterContext): AsyncIterable<SourceRef> {
  const root = projectsRoot(ctx);
  const projectDirs = await ctx.fs.readdir(root);

  for (const projectDirName of projectDirs) {
    const projectDir = join(root, projectDirName);
    const projectStat = await ctx.fs.stat(projectDir);
    if (!projectStat?.isDirectory) continue;

    const entries = await ctx.fs.readdir(projectDir);

    for (const entry of entries) {
      if (isRootSessionFile(entry)) {
        const sessionId = sessionIdFromRootFile(entry);
        const path = join(projectDir, entry);
        const stat = await ctx.fs.stat(path);
        if (!stat) continue;
        yield {
          sourceId: sessionId,
          path,
          kind: 'root',
          sizeBytes: stat.sizeBytes,
          mtimeMs: stat.mtimeMs,
        };
        continue;
      }

      if (isIgnoredEntry(entry)) continue;

      // A directory named after a session id: <sessionId>/subagents/agent-*.jsonl.
      const sessionDir = join(projectDir, entry);
      const sessionDirStat = await ctx.fs.stat(sessionDir);
      if (!sessionDirStat?.isDirectory) continue;

      const subagentsDir = join(sessionDir, 'subagents');
      const subagentsStat = await ctx.fs.stat(subagentsDir);
      if (!subagentsStat?.isDirectory) continue;

      const sessionId = entry;
      for (const agentFile of await ctx.fs.readdir(subagentsDir)) {
        if (!isAgentFile(agentFile)) continue;
        const agentId = agentIdFromFile(agentFile);
        const path = join(subagentsDir, agentFile);
        const stat = await ctx.fs.stat(path);
        if (!stat) continue;
        yield {
          sourceId: `${sessionId}/${agentId}`,
          path,
          kind: 'child',
          sizeBytes: stat.sizeBytes,
          mtimeMs: stat.mtimeMs,
          parentHint: sessionId,
        };
      }
    }
  }
}
