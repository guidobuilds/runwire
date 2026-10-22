// Ledger read: `gentle-agents/tasks/<id>.json` (gentle-shell.md §2.2/§5).
// LINK METADATA ONLY — the ledger's `tokens/cost/turns/toolCalls` aggregates
// duplicate the child session exactly (verified in the reference data) and the
// remaining keys (`prompt`, `result`, `error`, `label`, `lastStep`, and the
// whole `thread`) are child prompt/answer/behaviour content. This module never
// returns them (S9).
import { basename } from 'node:path/posix';
import type { AdapterContext } from '@runwire/core';
import { sessionIdFromRootFile } from '../pi/paths';

export type TaskLink = {
  id: string;
  agent?: string;
  parentSessionId?: string;
  /** The child session file the task wrote (absolute under the agent home). */
  sessionPath?: string;
  /** uuid of the child session, taken from `sessionPath`'s filename. */
  childUuid?: string;
};

export type LedgerResult = {
  /** Child-session uuid → its task link. */
  byChildUuid: Map<string, TaskLink>;
  /** Task ids whose parent is not resolvable from the ledger alone. */
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

/**
 * Reads every `tasks/*.json` under the given roots. One unparseable or
 * shape-invalid file counts into `invalidFiles` (aggregated into the
 * `ledger-invalid` diagnostic by the caller); a valid file always yields its
 * child-uuid key when `sessionPath` names a `<ts>_<uuid>.jsonl`.
 */
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
      // The ledger record is `{ task: {...}, thread: {...} }`; only `task` is
      // touched, and only its link keys — `thread` is content and is ignored
      // without being read into memory here either way (JSON.parse already
      // materialized it, but nothing below projects it).
      const task = (parsed as { task?: TaskShape } | null)?.task;
      const id = str(task?.id);
      if (!task || !id) {
        invalidFiles++;
        continue;
      }
      const sessionPath = str(task.sessionPath);
      // `<ISO timestamp>_<uuidv7>.jsonl` → the uuid only, same rule as the
      // session walk, so path layout differences between machines never matter.
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
