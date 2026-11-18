import { basename } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';
import { sessionIdFromRootFile } from '../pi/paths';

export type TaskLink = {
  id: string;
  agent?: string;
  parentSessionId?: string;
  sessionPath?: string;
  childUuid?: string;
};

export type LedgerResult = {
  byChildUuid: Map<string, TaskLink>;
  invalidFiles: number;
};

type TaskShape = {
  id?: unknown;
  agent?: unknown;
  parentSessionId?: unknown;
  sessionPath?: unknown;
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function readLedger(
  ctx: AdapterContext,
  roots: readonly string[],
): Promise<LedgerResult> {
  const byChildUuid = new Map<string, TaskLink>();
  let invalidFiles = 0;

  for (const root of roots) {
    const stat = await ctx.fs.stat(root);
    if (!stat?.isDirectory) continue;
    const entries = [...(await ctx.fs.readdir(root))].sort();
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const path = `${root}/${entry}`;
      let parsed: unknown;
      try {
        const raw = await ctx.fs.readFile(path);
        if (raw === undefined) throw new Error('unreadable ledger file');
        parsed = JSON.parse(raw);
      } catch {
        invalidFiles++;
        continue;
      }
      const task = (parsed as { task?: TaskShape } | null)?.task;
      const id = str(task?.id);
      if (!task || !id) {
        invalidFiles++;
        continue;
      }
      const sessionPath = str(task.sessionPath);
      const childUuid = sessionPath ? sessionIdFromRootFile(basename(sessionPath)) : undefined;
      const link: TaskLink = {
        id,
        agent: str(task.agent),
        parentSessionId: str(task.parentSessionId),
        sessionPath,
        childUuid,
      };
      if (childUuid) byChildUuid.set(childUuid, link);
    }
  }

  return { byChildUuid, invalidFiles };
}
