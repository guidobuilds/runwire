import type {
  Capability,
  HarnessId,
  Metric,
  SessionRollup,
  SessionSummary,
  Usage,
} from '../../api/types';
import { shortId } from '../../lib/format';

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
  harness: HarnessId;
  projectKey: string;
  projectName: string;
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

  return {
    id: summary.id,
    label: title && title.trim() !== '' ? title : shortId(summary.id),
    harness: summary.harness,
    projectKey: summary.project.key,
    projectName: summary.project.name,
    model: summary.model.primary,
    mode: summary.mode?.primary,
    startedAt: summary.timing.startedAt,
    durationMs: summary.timing.durationMs,
    usage: (prefs.inclusive ? (inclusiveUsage ?? summary.usage) : summary.usage) ?? EMPTY_USAGE,
    subagents: rollup?.inclusive.counts.subagents,
    hasSubagents: summary.children.length > 0,
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
