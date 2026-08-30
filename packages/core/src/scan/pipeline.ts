import type { AdapterContext, HarnessAdapter, SourceRef } from '../adapter/types';
import { link, type SourcedReducedSession } from '../link/link';
import { type Diagnostic, makeDiagnostic } from '../model/diagnostic';
import type { HarnessId } from '../model/harness';
import type { SessionRollup } from '../model/rollup';
import type { ProjectRef, SessionSummary } from '../model/session';
import type { ProjectIdentityMode } from '../project/resolve';
import { resolveProject } from '../project/resolve';
import { type ReducedSession, reduce } from '../reduce/reduce';

export type ScanReport = {
  startedAt: string;
  durationMs: number;
  perAdapter: Record<
    string,
    { discovered: number; parsed: number; reused: number; failed: number; durationMs: number }
  >;
  diagnostics: Diagnostic[];
};

export type CachedSource = { ref: SourceRef; reduced: ReducedSession };

export type ScanOptions = {
  concurrency?: number;
  projectIdentity?: ProjectIdentityMode;
};

export type ScanState = {
  /** key: `${harness}:${sourceId}`. */
  cache: Map<string, CachedSource>;
  summaries: SessionSummary[];
  rollups: Map<string, SessionRollup>;
  /** key: cwd. Cached for the lifetime of the store (docs/ARCHITECTURE.md §7). */
  projectCache: Map<string, ProjectRef>;
};

export function createScanState(): ScanState {
  return { cache: new Map(), summaries: [], rollups: new Map(), projectCache: new Map() };
}

const DEFAULT_CONCURRENCY = 4;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Runs probe -> discover -> (reuse or parse+reduce) for every adapter, then
 * resolves projects, links, and rolls up (docs/ARCHITECTURE.md §5). Mutates
 * `state` in place and returns the ScanReport. A failing source or adapter
 * never stops the scan.
 */
export async function scan(
  adapters: HarnessAdapter[],
  ctx: AdapterContext,
  state: ScanState,
  opts: ScanOptions = {},
): Promise<ScanReport> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const diagnostics: Diagnostic[] = [];
  const perAdapter: ScanReport['perAdapter'] = {};
  const seenKeys = new Set<string>();

  for (const adapter of adapters) {
    const adapterT0 = performance.now();
    let discovered = 0;
    let parsed = 0;
    let reused = 0;
    let failed = 0;

    const refs: SourceRef[] = [];
    try {
      const probeResult = await adapter.probe(ctx);
      if (!probeResult.installed) {
        perAdapter[adapter.id] = {
          discovered: 0,
          parsed: 0,
          reused: 0,
          failed: 0,
          durationMs: performance.now() - adapterT0,
        };
        continue;
      }
      for await (const ref of adapter.discover(ctx)) refs.push(ref);
    } catch (err) {
      diagnostics.push(
        errorDiagnostic(
          'adapter-discover-failed',
          `discover() failed: ${errorMessage(err)}`,
          adapter.id,
          '',
        ),
      );
      perAdapter[adapter.id] = {
        discovered: 0,
        parsed: 0,
        reused: 0,
        failed: 1,
        durationMs: performance.now() - adapterT0,
      };
      continue;
    }
    discovered = refs.length;

    await runWithConcurrency(refs, concurrency, async (ref) => {
      const key = `${adapter.id}:${ref.sourceId}`;
      const cached = state.cache.get(key);
      if (cached && cached.ref.sizeBytes === ref.sizeBytes && cached.ref.mtimeMs === ref.mtimeMs) {
        reused++;
        seenKeys.add(key);
        return;
      }
      try {
        const events = adapter.parse(ref, ctx);
        const reduced = await reduce(events, {
          harness: adapter.id,
          path: ref.path,
          privacyTitles: ctx.privacy.titles,
        });
        parsed++;
        seenKeys.add(key);
        state.cache.set(key, { ref, reduced });
      } catch (err) {
        failed++;
        diagnostics.push(
          errorDiagnostic(
            'source-parse-failed',
            `parse/reduce failed: ${errorMessage(err)}`,
            adapter.id,
            ref.path,
          ),
        );
      }
    });

    perAdapter[adapter.id] = {
      discovered,
      parsed,
      reused,
      failed,
      durationMs: performance.now() - adapterT0,
    };
  }

  // Drop cache entries whose source disappeared since the last scan.
  for (const key of [...state.cache.keys()]) {
    if (!seenKeys.has(key)) state.cache.delete(key);
  }

  const allSourced: SourcedReducedSession[] = [...state.cache.values()].map(({ ref, reduced }) => ({
    ref,
    reduced,
  }));

  // Project resolution is async I/O; resolve every distinct cwd once
  // up front (cached for the store's lifetime), so link() itself can stay
  // a pure, synchronous, easily-testable function.
  const projectIdentityMode = opts.projectIdentity ?? 'repo';
  const distinctCwds = new Set(
    allSourced.map((s) => s.reduced.cwd.first).filter((c) => c.length > 0),
  );
  const projectByCwd = new Map<string, ProjectRef>();
  await runWithConcurrency([...distinctCwds], concurrency, async (cwd) => {
    let project = state.projectCache.get(cwd);
    if (!project) {
      project = await resolveProject({ cwd }, { fs: ctx.fs, mode: projectIdentityMode });
      state.projectCache.set(cwd, project);
    }
    projectByCwd.set(cwd, project);
  });

  const { summaries, rollups } = link(allSourced, (_harness, cwd) => {
    const found = projectByCwd.get(cwd.first);
    if (found) return found;
    return { key: cwd.first || 'unknown', name: cwd.first || 'unknown', identity: 'cwd' };
  });

  state.summaries = summaries;
  state.rollups = rollups;

  for (const s of summaries) diagnostics.push(...s.diagnostics);

  return { startedAt, durationMs: performance.now() - t0, perAdapter, diagnostics };
}

function errorDiagnostic(
  code: string,
  message: string,
  harness: HarnessId,
  path: string,
): Diagnostic {
  const oneLine = message.replace(/\s*\n\s*/g, ' ');
  return makeDiagnostic({
    level: 'error',
    code,
    message: oneLine.length > 200 ? `${oneLine.slice(0, 197)}...` : oneLine,
    harness,
    path,
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
