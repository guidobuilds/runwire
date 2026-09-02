import type {
  Capability,
  Confidence,
  HarnessId,
  Metric,
  SessionRollup,
  SessionSummary,
  Usage,
} from '../../api/types';
import { shortId } from '../../lib/format';
import { isMachineInitiated } from '../../lib/initiator';

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * The weakest (lowest) confidence across a row's visible metrics, or
 * `undefined` when none of them are present. This is the row-level
 * confidence subtext / `ConfidenceDot` design.md §5 asks for next to the
 * session label — a single signal standing in for "how much of this row
 * should I trust," not a replacement for each cell's own `ConfidenceMarker`.
 */
function weakestConfidence(
  metrics: ReadonlyArray<Metric<unknown> | undefined>,
): Confidence | undefined {
  let worst: Confidence | undefined;
  for (const metric of metrics) {
    if (!metric) continue;
    if (worst === undefined || CONFIDENCE_RANK[metric.confidence] < CONFIDENCE_RANK[worst]) {
      worst = metric.confidence;
    }
  }
  return worst;
}

/**
 * The two prefs the row projection depends on (design.md §3/§6). Narrower than
 * the whole `Prefs` snapshot so `toSessionRow` stays a pure function that the
 * unit tests can drive without touching the store.
 */
export type SessionRowPrefs = {
  inclusive: boolean;
  showTitles: boolean;
};

/**
 * One row of the session view, projected from a summary + its rollup exactly
 * once per render (design.md §6). Metrics are carried whole — not unwrapped to
 * numbers — because every cell renders through `MetricCell`, which needs the
 * confidence and provenance alongside the value.
 */
export type SessionRow = {
  id: string;
  /** `title.value` when titles are on and one exists, else `shortId(id)`. */
  label: string;
  /**
   * `shortId(id)`, always populated regardless of the Titles pref — the
   * landing row anatomy's "id" subtext under the title (design.md §5). When
   * titles are off `label` already equals this value, so callers should only
   * render it as a separate subtext line when titles are on.
   */
  shortId: string;
  harness: HarnessId;
  projectKey: string;
  projectName: string;
  projectWorktree?: string;
  /** `summary.diagnostics.length > 0` — drives the row's diagnostic icon. */
  hasDiagnostics: boolean;
  /** {@link weakestConfidence} across this row's visible metrics. */
  confidence?: Confidence;
  model?: Metric<string>;
  mode?: Metric<string>;
  startedAt?: Metric<string>;
  durationMs?: Metric;
  /** Follows the inclusive toggle: rollup inclusive usage, else the session's own. */
  usage: Usage;
  /**
   * Always the inclusive subagent count. This is a tree property, not a metric
   * of the session itself, so the exclusive/inclusive toggle does not apply to
   * it (design.md §6) — and core only ever publishes it on a rollup.
   */
  subagents?: Metric;
  hasSubagents: boolean;
  /**
   * The harness says a machine started this session (SDK, CI, agent dispatch).
   *
   * Carried so a view can *label* the row, never so it can drop it: the
   * automated filter runs server-side (`?automated=exclude`) precisely because
   * hiding a session has to remove it from the aggregates too. Compare in
   * particular resolves sessions by explicit id and must keep rendering a
   * machine-started column while the lists hide it — filtering here instead
   * would delete the user's own selection.
   */
  isAutomated: boolean;
  summary: SessionSummary;
  rollup?: SessionRollup;
};

const EMPTY_USAGE: Usage = {};

/**
 * Projects one summary into a row. `rollup` is optional because the server only
 * includes a rollup for sessions it has one for; without it the inclusive view
 * falls back to the session's own (exclusive) usage rather than rendering
 * nothing.
 */
export function toSessionRow(
  summary: SessionSummary,
  rollup: SessionRollup | undefined,
  prefs: SessionRowPrefs,
): SessionRow {
  const title = prefs.showTitles ? summary.title?.value : undefined;
  const inclusiveUsage = rollup?.inclusive.usage;
  const usage =
    (prefs.inclusive ? (inclusiveUsage ?? summary.usage) : summary.usage) ?? EMPTY_USAGE;
  const subagents = rollup?.inclusive.counts.subagents;

  return {
    id: summary.id,
    label: title && title.trim() !== '' ? title : shortId(summary.id),
    shortId: shortId(summary.id),
    harness: summary.harness,
    projectKey: summary.project.key,
    projectName: summary.project.name,
    projectWorktree: summary.project.worktree,
    hasDiagnostics: summary.diagnostics.length > 0,
    confidence: weakestConfidence([
      summary.model.primary,
      summary.mode?.primary,
      summary.timing.startedAt,
      summary.timing.durationMs,
      usage.uncachedInput,
      usage.cachedInput,
      usage.output,
      subagents,
    ]),
    model: summary.model.primary,
    mode: summary.mode?.primary,
    startedAt: summary.timing.startedAt,
    durationMs: summary.timing.durationMs,
    usage,
    subagents,
    hasSubagents: summary.children.length > 0,
    isAutomated: isMachineInitiated(summary),
    summary,
    rollup,
  };
}

/** Projects a whole list, pairing each summary with its rollup by id. */
export function toSessionRows(
  summaries: readonly SessionSummary[],
  rollups: Readonly<Record<string, SessionRollup>>,
  prefs: SessionRowPrefs,
): SessionRow[] {
  return summaries.map((summary) => toSessionRow(summary, rollups[summary.id], prefs));
}

/** What a bulk `MetricCell` caller needs to know about one harness. */
export type HarnessInfo = {
  capabilities?: readonly Capability[];
  displayName?: string;
};

/**
 * Harness id → adapter facts, resolved once by the caller (see
 * `useHarnessDirectory`). `undefined` is the legal "status still loading" value
 * and flows straight through to `MetricCell.capabilities`, which reads it as
 * `missing` (design.md §5/§6).
 */
export type HarnessDirectory = Readonly<Record<string, HarnessInfo>>;
