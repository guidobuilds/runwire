// Gentle Shell discovery (docs/adapters/gentle-shell.md §2/§5/§9): parents of
// the isolated home plus every `gentle-agents/sessions` tree, with the task
// ledger read for link metadata only. Attribution follows decision 1 (S3/S7):
// this adapter never scans the user Pi home's parent root — that is Pi's — and
// never reads another adapter's files (S8): parent resolution below is an
// existence check on file NAMES, not a content read.
import { join } from 'node:path/posix';
import type { AdapterContext, Diagnostic, Known, SessionBundle } from '@runwire/core';
import { makeDiagnostic } from '@runwire/core';
import { computeBundle } from '../pi/compute';
import { decodeProjectDirname, isSessionFile, sessionIdFromRootFile } from '../pi/paths';
import { resolveProject } from '../pi/project';
import { readRecords } from '../pi/records';
import { type LedgerResult, readLedger } from './ledger';
import {
  type ChildRoot,
  childrenRoots,
  gentleParentsRoot,
  ledgerRoots,
  sharesParentRoot,
  userPiHome,
} from './paths';

const HARNESS_ID = 'gentle-shell';

function enumeratedDirVanished(path: string): Error {
  return new Error(`enumerated directory vanished before its listing: ${path}`);
}

type Stat = { sizeBytes: number; mtimeMs: number };

function unchanged(known: Known, path: string, stat: Stat): boolean {
  const k = known.get(path);
  return k !== undefined && k.size === stat.sizeBytes && k.mtime === stat.mtimeMs;
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s*\n\s*/g, ' ').trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
}

/**
 * Every root this adapter could own, existing or not (gentle-shell.md §9):
 * `loadKnown` scopes stored rows by `probe.roots`, so an omitted root would
 * strand its sessions in the DB forever when it disappears.
 */
export async function probe(
  ctx: AdapterContext,
): Promise<{ installed: boolean; roots: string[]; notes: string[] }> {
  const parents = sharesParentRoot(ctx) ? [] : [gentleParentsRoot(ctx)];
  const children = childrenRoots(ctx).map((c) => c.root);
  const candidates = [...parents, ...children];

  const notes: string[] = [];
  let installed = false;
  for (const root of candidates) {
    const stat = await ctx.fs.stat(root);
    if (!stat?.isDirectory) {
      notes.push(`${root} not found`);
      continue;
    }
    installed = true;
    if (root === gentleParentsRoot(ctx)) {
      notes.push(await countParentNotes(ctx, root));
    } else {
      notes.push(await countFlatNotes(ctx, root));
    }
  }
  return { installed, roots: candidates, notes };
}

async function countParentNotes(ctx: AdapterContext, root: string): Promise<string> {
  let fileCount = 0;
  let projectDirCount = 0;
  for (const name of await ctx.fs.readdir(root)) {
    const projectStat = await ctx.fs.stat(join(root, name));
    if (!projectStat?.isDirectory) continue;
    projectDirCount++;
    fileCount += (await ctx.fs.readdir(join(root, name))).filter(isSessionFile).length;
  }
  return `${root}: ${projectDirCount} project director(ies), ${fileCount} *.jsonl file(s)`;
}

async function countFlatNotes(ctx: AdapterContext, root: string): Promise<string> {
  const fileCount = (await ctx.fs.readdir(root)).filter(isSessionFile).length;
  return `${root}: ${fileCount} *.jsonl file(s)`;
}

type SourceBundleInput = {
  sessionId: string;
  headerUuid: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  fallbackCwd?: string;
};

/** Reads + computes one source; a read failure yields a stub bundle instead of throwing. */
async function computeSourceBundle(
  ctx: AdapterContext,
  input: SourceBundleInput,
): Promise<SessionBundle> {
  try {
    const { records: recordStream, result } = readRecords(ctx, input.path);
    const parsed: Array<{
      record: Parameters<typeof computeBundle>[0]['records'][number]['record'];
      line: number;
    }> = [];
    for await (const r of recordStream) parsed.push(r);
    const { diagnostics: recordDiagnostics } = result();

    return await computeBundle({
      sessionId: input.sessionId,
      source: { path: input.path, sizeBytes: input.sizeBytes, mtimeMs: input.mtimeMs },
      records: parsed,
      recordDiagnostics,
      resolveProject: (cwd) => resolveProject({ cwd }, { fs: ctx.fs }),
      fallbackCwd: input.fallbackCwd,
      headerUuid: input.headerUuid,
      harnessId: HARNESS_ID,
      ctx,
    });
  } catch (err) {
    const diagnostic: Diagnostic = makeDiagnostic(
      'error',
      'session-read-failed',
      sanitizeErrorMessage(err),
    );
    return {
      project: { key: input.sessionId, name: input.sessionId, identity: 'cwd' },
      session: {
        id: input.sessionId,
        harnessId: HARNESS_ID,
        projectKey: input.sessionId,
        depth: 0,
        sourcePath: input.path,
        sourceSize: input.sizeBytes,
        sourceMtime: input.mtimeMs,
      },
      steps: [],
      diagnostics: [diagnostic],
    };
  }
}

/**
 * uuid → owning parent root, built from FILENAMES only (no content read of any
 * Pi-owned file, S8): `gentle-shell:<uuid>` for the isolated home's parents,
 * `pi:<uuid>` when the file exists under the user Pi home's parent root.
 */
async function parentIndex(ctx: AdapterContext): Promise<Map<string, 'gentle-shell' | 'pi'>> {
  const index = new Map<string, 'gentle-shell' | 'pi'>();
  const roots: Array<['gentle-shell' | 'pi', string]> = [
    ['gentle-shell', gentleParentsRoot(ctx)],
    ['pi', join(userPiHome(ctx), 'sessions')],
  ];
  for (const [harness, root] of roots) {
    const rootStat = await ctx.fs.stat(root);
    if (!rootStat?.isDirectory) continue;
    for (const name of await ctx.fs.readdir(root)) {
      const dirStat = await ctx.fs.stat(join(root, name));
      if (!dirStat?.isDirectory) continue;
      for (const entry of await ctx.fs.readdir(join(root, name))) {
        if (!isSessionFile(entry)) continue;
        const uuid = sessionIdFromRootFile(entry);
        // First wins: the gentle home is checked first, and a uuid under both
        // parent roots would be ambiguous anyway.
        if (!index.has(uuid)) index.set(uuid, harness);
      }
    }
  }
  return index;
}

/** `usage`-record count used as the duplicate tiebreaker (gentle-shell.md §9). */
async function countUsageRecords(ctx: AdapterContext, path: string): Promise<number> {
  try {
    const raw = await ctx.fs.readFile(path);
    if (raw === undefined) return 0;
    let count = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { type?: unknown; message?: { usage?: unknown } };
        if (record.type === 'usage' || record.message?.usage !== undefined) count++;
      } catch {
        // A malformed line cannot contribute a usage record.
      }
    }
    return count;
  } catch {
    return 0;
  }
}

type ChildCandidate = {
  uuid: string;
  path: string;
  stat: Stat;
  home: ChildRoot['home'];
};

/** Ledger + parent-prefix state shared by the children pass. */
type LinkState = {
  ledger: LedgerResult;
  parents: Map<string, 'gentle-shell' | 'pi'>;
};

function childDiagnostics(uuid: string, link: LinkState, isDuplicate: boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (isDuplicate) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'duplicate-child',
        'The same child uuid exists under two homes; one bundle emitted',
        { count: 1 },
      ),
    );
  }
  const task = link.ledger.byChildUuid.get(uuid);
  if (!task) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'unlinked-subagent',
        'Child session without a ledger task (pruned or missing); imported as a root',
        { count: 1 },
      ),
    );
    return diagnostics;
  }
  if (task.parentSessionId && !link.parents.has(task.parentSessionId)) {
    diagnostics.push(
      makeDiagnostic(
        'info',
        'orphan-parent',
        'Ledger parentSessionId resolves to no imported parent file',
        { count: 1 },
      ),
    );
  }
  return diagnostics;
}

export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  const link: LinkState = {
    ledger: await readLedger(ctx, ledgerRoots(ctx)),
    parents: await parentIndex(ctx),
  };
  const touchedRoots: string[] = [];

  // --- parents (isolated home only) ---
  if (!sharesParentRoot(ctx)) {
    const root = gentleParentsRoot(ctx);
    const rootStat = await ctx.fs.stat(root);
    if (rootStat?.isDirectory) {
      touchedRoots.push(root);
      const projectDirNames = [...(await ctx.fs.readdir(root))].sort();
      for (const projectDirName of projectDirNames) {
        const projectDir = join(root, projectDirName);
        const projectStat = await ctx.fs.stat(projectDir);
        if (projectStat === undefined) throw enumeratedDirVanished(projectDir);
        if (!projectStat.isDirectory) continue;
        const entries = [...(await ctx.fs.readdir(projectDir))].sort();
        const fallbackCwd = decodeProjectDirname(projectDirName);
        for (const entry of entries) {
          if (!isSessionFile(entry)) continue;
          const path = join(projectDir, entry);
          const stat = await ctx.fs.stat(path);
          if (!stat) continue;
          if (unchanged(known, path, stat)) continue;
          const uuid = sessionIdFromRootFile(entry);
          yield await computeSourceBundle(ctx, {
            sessionId: `${HARNESS_ID}:${uuid}`,
            headerUuid: uuid,
            path,
            sizeBytes: stat.sizeBytes,
            mtimeMs: stat.mtimeMs,
            fallbackCwd,
          });
        }
      }
    }
  }

  // --- children: flat directories, deduped by uuid across homes ---
  const candidates: ChildCandidate[] = [];
  for (const { home, root } of childrenRoots(ctx)) {
    const rootStat = await ctx.fs.stat(root);
    if (!rootStat?.isDirectory) continue;
    touchedRoots.push(root);
    for (const entry of [...(await ctx.fs.readdir(root))].sort()) {
      if (!isSessionFile(entry)) continue;
      const path = join(root, entry);
      const stat = await ctx.fs.stat(path);
      if (!stat) continue;
      candidates.push({ uuid: sessionIdFromRootFile(entry), path, stat, home });
    }
  }

  const byUuid = new Map<string, ChildCandidate[]>();
  for (const candidate of candidates) {
    const existing = byUuid.get(candidate.uuid) ?? [];
    existing.push(candidate);
    byUuid.set(candidate.uuid, existing);
  }

  // Filename order (uuidv7) keeps the stream deterministic across homes.
  const ordered = [...byUuid.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [uuid, group] of ordered) {
    const first = group[0];
    if (first === undefined) continue; // empty groups cannot happen; guard for noUncheckedIndexedAccess
    let winner = first;
    if (group.length > 1) {
      let bestCount = -1;
      for (const candidate of group) {
        const usageCount = await countUsageRecords(ctx, candidate.path);
        if (
          usageCount > bestCount ||
          (usageCount === bestCount && candidate.stat.mtimeMs > winner.stat.mtimeMs)
        ) {
          bestCount = usageCount;
          winner = candidate;
        }
      }
    }

    const extraDiagnostics = childDiagnostics(winner.uuid, link, group.length > 1);
    if (unchanged(known, winner.path, winner.stat)) continue;
    const bundle = await computeSourceBundle(ctx, {
      sessionId: `${HARNESS_ID}:${uuid}`,
      headerUuid: uuid,
      path: winner.path,
      sizeBytes: winner.stat.sizeBytes,
      mtimeMs: winner.stat.mtimeMs,
    });
    // Ledger aggregates are never used (S9); the ledger only tags linkage
    // diagnostics here so the gap stays visible instead of silent (§5.2).
    bundle.diagnostics = [...bundle.diagnostics, ...extraDiagnostics];
    yield bundle;
  }

  // Revalidate every root touched by enumeration (D83): a vanished root means
  // the enumeration was partial; throwing keeps history and clears the
  // completed-refresh marker instead of pruning.
  for (const root of touchedRoots) {
    const stat = await ctx.fs.stat(root);
    if (!stat?.isDirectory) throw enumeratedDirVanished(root);
  }
}
