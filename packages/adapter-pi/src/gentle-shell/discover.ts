// Gentle Shell discovery (docs/adapters/gentle-shell.md §2/§5/§9): parents of
// the isolated home plus every `gentle-agents/sessions` tree, with the task
// ledger read for link metadata only. Attribution follows decision 1 (S3/S7):
// this adapter never scans the user Pi home's parent root — that is Pi's — and
// never reads another adapter's files (S8): parent resolution below is an
// existence check on file NAMES, not a content read.
import { join } from 'node:path/posix';
import type { AdapterContext, Diagnostic, Known, Projection, SessionBundle } from '@runwire/core';
import { makeDiagnostic, project, readLinesRaw } from '@runwire/core';
import { computeBundle } from '../pi/compute';
import { decodeProjectDirname, isSessionFile, sessionIdFromRootFile } from '../pi/paths';
import { resolveProject } from '../pi/project';
import { readRecords } from '../pi/records';
import { gentleShellAllowlist } from './allowlist';
import { type LedgerResult, readLedger } from './ledger';
import {
  type ChildRoot,
  childrenRoots,
  gentleParentsRoot,
  ledgerRoots,
  sharesParentRoot,
  userPiHome,
} from './paths';
import { gentleToolCategory } from './tool-category';

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
  subagent?: Parameters<typeof computeBundle>[0]['subagent'];
  initiator?: Parameters<typeof computeBundle>[0]['initiator'];
  knownSessionUuids?: Parameters<typeof computeBundle>[0]['knownSessionUuids'];
};

/** Reads + computes one source; a read failure yields a stub bundle instead of throwing. */
async function computeSourceBundle(
  ctx: AdapterContext,
  input: SourceBundleInput,
): Promise<SessionBundle> {
  try {
    const { records: recordStream, result } = readRecords(ctx, input.path, {
      pi12: true,
      allowlist: gentleShellAllowlist,
    });
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
      pi12: true,
      toolCategory: gentleToolCategory,
      subagent: input.subagent,
      initiator: input.initiator,
      knownSessionUuids: input.knownSessionUuids,
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
type ParentSource = { harness: 'gentle-shell' | 'pi'; path: string };

async function parentIndex(ctx: AdapterContext): Promise<Map<string, ParentSource>> {
  const index = new Map<string, ParentSource>();
  const roots: Array<['gentle-shell' | 'pi', string]> = [
    ...(!sharesParentRoot(ctx)
      ? [['gentle-shell', gentleParentsRoot(ctx)] as ['gentle-shell', string]]
      : []),
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
        if (!index.has(uuid)) index.set(uuid, { harness, path: join(root, name, entry) });
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
  parents: Map<string, ParentSource>;
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
  if (
    task.parentSessionId &&
    !link.parents.has(task.parentSessionId) &&
    !link.ledger.byChildUuid.has(task.parentSessionId)
  ) {
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

/**
 * Spawn identity of one parent session (gentle-shell.md §5.1, S3b).
 * `receiptOnly` holds the task ids whose toolCallId came ONLY from a
 * `review-reminder-receipt` entry, so the caller can report the count without
 * naming anything.
 */
type SpawnCalls = { calls: Map<string, string>; receiptOnly: Set<string> };

/** The 4.x receipt that corroborates a subagent spawn (S3b). */
const RECEIPT_CUSTOM_TYPE = 'gentle-pi.review-reminder-receipt/v1';

/**
 * Identity projection for the parent scan: the `gentleAgents` toolResult
 * identity is the primary source, a subagent receipt the secondary one. Every
 * other receipt key (`root`, `id`, `toolName`, `writerModelId`,
 * `writerEffort`) and every other custom payload stays unread.
 */
const SPAWN_LINK_PROJECTION: Projection = {
  message: { role: true, toolCallId: true, details: { gentleAgents: { taskId: true } } },
  customType: true,
  data: { source: true, taskId: true, toolCallId: true },
};

type SpawnIdentity = {
  message?: {
    role?: unknown;
    toolCallId?: unknown;
    details?: { gentleAgents?: { taskId?: unknown } };
  };
  customType?: unknown;
  data?: { source?: unknown; taskId?: unknown; toolCallId?: unknown };
};

/** Retain only spawn identity from owned parents; Pi-owned paths never reach this reader. */
async function spawnCalls(ctx: AdapterContext, parent: ParentSource): Promise<SpawnCalls> {
  const primary = new Map<string, string>();
  const secondary = new Map<string, string>();
  if (parent.harness !== HARNESS_ID) return { calls: primary, receiptOnly: new Set<string>() };
  try {
    for await (const { line } of readLinesRaw(ctx.fs.openStream(parent.path), {
      truncated: false,
      oversizedLines: 0,
    })) {
      if (!line.includes('gentleAgents') && !line.includes(RECEIPT_CUSTOM_TYPE)) continue;
      try {
        const identity = project(JSON.parse(line), SPAWN_LINK_PROJECTION) as SpawnIdentity;
        const message = identity.message;
        const taskId = message?.details?.gentleAgents?.taskId;
        if (
          message?.role === 'toolResult' &&
          typeof taskId === 'string' &&
          typeof message.toolCallId === 'string'
        ) {
          primary.set(taskId, message.toolCallId);
          continue;
        }
        const data = identity.data;
        if (
          identity.customType === RECEIPT_CUSTOM_TYPE &&
          data?.source === 'subagent' &&
          typeof data.taskId === 'string' &&
          typeof data.toolCallId === 'string'
        ) {
          if (!secondary.has(data.taskId)) secondary.set(data.taskId, data.toolCallId);
        }
      } catch {
        // Malformed lines cannot supply a spawn identity.
      }
    }
  } catch {
    // A missing/unreadable owned parent leaves spawnCallId unknown.
  }

  // Primary wins: a receipt only fills a slot the toolResult identity left empty.
  const receiptOnly = new Set<string>();
  for (const [taskId, toolCallId] of secondary) {
    if (primary.has(taskId)) continue;
    primary.set(taskId, toolCallId);
    receiptOnly.add(taskId);
  }
  return { calls: primary, receiptOnly };
}

function childDepth(
  uuid: string,
  link: LinkState,
  visited = new Set<string>(),
): number | undefined {
  if (visited.has(uuid)) return undefined;
  visited.add(uuid);
  const parent = link.ledger.byChildUuid.get(uuid)?.parentSessionId;
  if (!parent) return undefined;
  if (link.ledger.byChildUuid.has(parent)) {
    const depth = childDepth(parent, link, visited);
    return depth === undefined ? undefined : depth + 1;
  }
  return link.parents.has(parent) ? 1 : undefined;
}

export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  const link: LinkState = {
    ledger: await readLedger(ctx, ledgerRoots(ctx)),
    parents: await parentIndex(ctx),
  };
  const touchedRoots: string[] = [];
  const spawnByParent = new Map<string, SpawnCalls>();
  let ledgerDiagnosticPending = link.ledger.invalidFiles > 0;
  function attachLedgerDiagnostic(bundle: SessionBundle): SessionBundle {
    if (ledgerDiagnosticPending) {
      bundle.diagnostics = [
        ...bundle.diagnostics,
        makeDiagnostic(
          'info',
          'ledger-invalid',
          `${link.ledger.invalidFiles} ledger file(s) were invalid`,
          { count: link.ledger.invalidFiles },
        ),
      ];
      ledgerDiagnosticPending = false;
    }
    return bundle;
  }

  /**
   * Revalidate every root touched by enumeration (D83): a vanished root means
   * the enumeration was partial; throwing keeps history and clears the
   * completed-refresh marker instead of pruning. Called before the first child
   * is emitted as well as at the end, because child candidates are statted
   * before the first bundle (fork resolution needs their uuids) and a root that
   * vanished since must throw, never emit a stale or stub bundle.
   */
  async function revalidateTouchedRoots(): Promise<void> {
    for (const root of touchedRoots) {
      const stat = await ctx.fs.stat(root);
      if (!stat?.isDirectory) throw enumeratedDirVanished(root);
    }
  }

  // --- children candidates (filesystem only) ---
  // Enumerated before the first bundle so `knownUuids` (parents ∪ children) is
  // complete when a Pi 1.5.0 `parentSession` header resolves. Dispatch order
  // below is unchanged: parents first, then children.
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

  // An imported uuid is either a parent file or a child candidate; a fork header
  // naming anything else degrades to a diagnostic (see compute.ts).
  const knownUuids = new Set<string>([
    ...link.parents.keys(),
    ...candidates.map((candidate) => candidate.uuid),
  ]);

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
          yield attachLedgerDiagnostic(
            await computeSourceBundle(ctx, {
              sessionId: `${HARNESS_ID}:${uuid}`,
              headerUuid: uuid,
              path,
              sizeBytes: stat.sizeBytes,
              mtimeMs: stat.mtimeMs,
              fallbackCwd,
              knownSessionUuids: knownUuids,
            }),
          );
        }
      }
    }
  }

  await revalidateTouchedRoots();

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
    const task = link.ledger.byChildUuid.get(uuid);
    const parentUuid = task?.parentSessionId;
    const parent = parentUuid ? link.parents.get(parentUuid) : undefined;
    const parentHarness =
      parent?.harness ??
      (parentUuid && link.ledger.byChildUuid.has(parentUuid) ? HARNESS_ID : undefined);
    let spawnCallId: string | undefined;
    if (parentUuid && parent?.harness === HARNESS_ID && task) {
      let spawn = spawnByParent.get(parentUuid);
      if (!spawn) {
        spawn = await spawnCalls(ctx, parent);
        spawnByParent.set(parentUuid, spawn);
      }
      spawnCallId = spawn.calls.get(task.id);
      if (spawnCallId !== undefined && spawn.receiptOnly.has(task.id)) {
        // Count only: the receipt that supplied the link is never named (S7).
        extraDiagnostics.push(
          makeDiagnostic(
            'info',
            'receipt-spawn-link',
            'Spawn linkage resolved only from a review-reminder receipt entry',
            { count: 1 },
          ),
        );
      }
    }
    const bundle = await computeSourceBundle(ctx, {
      sessionId: `${HARNESS_ID}:${uuid}`,
      headerUuid: uuid,
      path: winner.path,
      sizeBytes: winner.stat.sizeBytes,
      mtimeMs: winner.stat.mtimeMs,
      subagent:
        task?.agent && parentHarness && parentUuid
          ? {
              parentId: `${parentHarness}:${parentUuid}`,
              agentType: task.agent,
              spawnCallId,
              depth: childDepth(uuid, link) ?? 1,
            }
          : undefined,
      initiator: task ? { kind: 'machine', automation: 'subagent-dispatch' } : undefined,
      knownSessionUuids: knownUuids,
    });
    // Ledger aggregates are never used (S9); only identity and linkage diagnostics survive.
    bundle.diagnostics = [...bundle.diagnostics, ...extraDiagnostics];
    yield attachLedgerDiagnostic(bundle);
  }

  await revalidateTouchedRoots();
}
