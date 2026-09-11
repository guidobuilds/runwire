// See paths.ts: every path here is built for ScoutFs (stat/readdir/readFile),
// not raw OS use, so it must stay '/'-joined via path.posix regardless of
// host OS - createMemoryFs's virtual layout is always '/'-based, and a real
// filesystem accepts '/' as a separator on Windows too.
import { join } from 'node:path/posix';
import type { AdapterContext, Diagnostic, Known, SessionBundle } from '@scout/core';
import { makeDiagnostic } from '@scout/core';
import { computeBundle } from './compute';
import { decodeProjectDirname, isSessionFile, sessionIdFromRootFile, sessionsRoot } from './paths';
import { resolveProject } from './project';
import { readRecords } from './records';

const HARNESS_ID = 'pi';

export async function probe(
  ctx: AdapterContext,
): Promise<{ installed: boolean; roots: string[]; notes: string[] }> {
  const root = sessionsRoot(ctx);
  const stat = await ctx.fs.stat(root);
  if (!stat?.isDirectory) {
    return { installed: false, roots: [], notes: [`${root} not found`] };
  }

  const projectDirNames = await ctx.fs.readdir(root);
  let projectDirCount = 0;
  let fileCount = 0;
  for (const name of projectDirNames) {
    const dirStat = await ctx.fs.stat(join(root, name));
    if (!dirStat?.isDirectory) continue;
    projectDirCount++;
    const entries = await ctx.fs.readdir(join(root, name));
    fileCount += entries.filter(isSessionFile).length;
  }

  return {
    installed: true,
    roots: [root],
    notes: [`${projectDirCount} project director(ies)`, `${fileCount} *.jsonl file(s)`],
  };
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
 * Sorted walk of `<agentDir>/sessions` (docs/adapters/pi.md §9). The scan is
 * deliberately NOT a recursive walk of `agentDir`: that would pick up
 * extension-run child sessions such as `gentle-agents/sessions/*.jsonl` and
 * attribute them to Pi (pi.md §2.1, D81). Each file is independent (no Claude-
 * style parent+child group), and `known` keys by `sourcePath` (Pi emits no
 * `sourceId`), so core's effective key is the path. Sorting by project dir then
 * filename makes the stream chronological and deterministic, since uuidv7
 * filenames sort in creation order.
 */
export async function* discover(ctx: AdapterContext, known: Known): AsyncIterable<SessionBundle> {
  const root = sessionsRoot(ctx);
  const projectDirNames = [...(await ctx.fs.readdir(root))].sort();

  for (const projectDirName of projectDirNames) {
    const projectDir = join(root, projectDirName);
    const projectStat = await ctx.fs.stat(projectDir);
    if (!projectStat?.isDirectory) continue;

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
