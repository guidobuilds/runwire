import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import type { SessionTrace, TraceStep } from '../../api/types';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { Tooltip } from '../primitives/Tooltip';
import { CONFIDENCE_OPACITY, KIND_BG_CLASS, KIND_COLOR, type KindKey } from './chart-theme';

/**
 * Real `SessionTrace`/`TraceStep` shape (`packages/core/src/model/trace.ts`,
 * `packages/core/src/trace/trace.ts`) does not match what the plan assumed
 * before this task investigated it — three adaptations, documented here
 * rather than silently invented:
 *
 * 1. **No `turnIndex` field.** Turn boundaries are their own step kind
 *    (`{ kind: 'turn', i, at?, durationMs? }`) interleaved in the stream, not
 *    an index carried by every step. Boundary positions are simply the `i`
 *    of every `kind: 'turn'` step.
 * 2. **No `cumulativeTokens` field.** Only `kind: 'call'` steps carry a
 *    running total, as `cum: UsageNumbers` (five separate numeric fields,
 *    not one pre-summed scalar). `cumulativeTokensOf` below sums them.
 * 3. **No per-step/series confidence.** `SessionTrace` carries raw counts,
 *    never a `Metric` wrapper, so there is no confidence grade to read for
 *    the D36 "low/medium confidence renders at reduced opacity + a
 *    ConfidenceDot" rule. The one real signal in the shape that means
 *    "this data is incomplete" is `SessionTrace.truncated` — a truncated
 *    trace is treated as medium-confidence for this rule (reduced-opacity
 *    blocks/line, a `ConfidenceDot level="medium"` in the header), a
 *    non-truncated trace is treated as high-confidence (no dot, matching
 *    `ConfidenceMarker`'s existing "high confidence renders nothing"
 *    precedent in `MetricCell.tsx`).
 *
 * `TraceStep.kind` (call/tool/turn/harness/compaction/model-change/
 * mode-change) and `ToolCategory` (read/write/exec/search/plan/agent/web/
 * mcp/other) also don't line up 1:1 with the 13 `--kind-*` tokens the way
 * the plan assumed ("13 tokens covering every TraceStep kind"). The actual
 * mapping, resolved here:
 * - `call` -> `--kind-model`.
 * - `tool` -> its `category` token directly for the 8 categories that have
 *   one (read/write/exec/search/plan/agent/web/mcp); `category: 'other'`
 *   (no `--kind-other` token exists) falls back to `--kind-prose`, the same
 *   bucket used for `compaction` steps below -- both are "a real thing
 *   happened but it isn't one of the eight tool categories or a model call".
 *   A tool step with `error: true` is colored `--kind-error` instead of its
 *   category color regardless of category -- error is a status overlay, not
 *   a category, and surfacing it is valuable enough not to defer.
 * - `harness` -> `--kind-harness-event`.
 * - `compaction` -> `--kind-prose` (see above).
 * - `turn` -> not rendered as a block at all; it drives the turn-boundary
 *   tick marks below the block row instead (design.md §4: "turn boundaries
 *   marked ... below").
 * - `model-change` / `mode-change` -> not rendered. D37 explicitly defers
 *   "model/mode-change markers" as a fidelity refinement; the step data
 *   stays available in `SessionTrace.steps` for that later pass, just not
 *   drawn here.
 * - `--kind-todo` has no current producer (`TodoWrite` maps to tool category
 *   `'plan'`, not a distinct kind, per `packages/adapter-claude-code/src/
 *   tool-category.ts`) and is unused by this component -- left for a future
 *   producer, not removed from the token set.
 */

const CATEGORY_TO_KIND: Record<string, KindKey> = {
  read: 'read',
  write: 'write',
  exec: 'exec',
  search: 'search',
  plan: 'plan',
  agent: 'agent',
  web: 'web',
  mcp: 'mcp',
};

type CallStep = Extract<TraceStep, { kind: 'call' }>;

/** The `KindKey` a step renders as, or `undefined` for steps not drawn as blocks. */
function blockKindOf(step: TraceStep): KindKey | undefined {
  switch (step.kind) {
    case 'call':
      return 'model';
    case 'tool':
      if (step.error) return 'error';
      return CATEGORY_TO_KIND[step.category] ?? 'prose';
    case 'harness':
      return 'harness-event';
    case 'compaction':
      return 'prose';
    default:
      return undefined;
  }
}

const KIND_LABEL: Record<KindKey, string> = {
  model: 'Model call',
  read: 'Read',
  write: 'Write',
  exec: 'Exec',
  search: 'Search',
  plan: 'Plan',
  agent: 'Agent',
  web: 'Web',
  mcp: 'MCP',
  skill: 'Skill',
  todo: 'Todo',
  prose: 'Other',
  error: 'Error',
  'harness-event': 'Harness event',
};

function stepDetail(step: TraceStep): string {
  switch (step.kind) {
    case 'call':
      return `Model call: ${step.model}`;
    case 'tool':
      return `${KIND_LABEL[step.error ? 'error' : (CATEGORY_TO_KIND[step.category] ?? 'prose')]}: ${step.name}${step.error ? ' (failed)' : ''}`;
    case 'harness':
      return `Harness event: ${step.name}`;
    case 'compaction':
      return 'Compaction';
    case 'turn':
      return 'Turn boundary';
    case 'model-change':
      return `Model changed: ${step.from} → ${step.to}`;
    case 'mode-change':
      return step.from ? `Mode changed: ${step.from} → ${step.to}` : `Mode: ${step.to}`;
  }
}

function cumulativeTokensOf(step: CallStep): number {
  const cum = step.cum;
  return cum.uncachedInput + cum.cachedInput + cum.cacheWrite + cum.output + cum.reasoningOutput;
}

export type TraceRibbonProps = {
  trace: SessionTrace | undefined;
  width?: number;
  /** Hides the legend and turn-boundary row, and reduces block height (Compare's f8 usage). */
  compact?: boolean;
  /**
   * Overrides the x-scale's upper domain bound (Compare's f8 usage, design.md
   * §4 / DECISIONS D33: "stacks N ribbons on a shared step-index axis").
   * Defaults to this trace's own max step index, i.e. every ribbon scales
   * independently unless a caller stacking several of them computes one
   * shared maximum across all of them and passes it here. Clamped up to this
   * trace's own `maxIndex` (never down) so a caller cannot accidentally clip
   * this trace's own steps off the visible range.
   */
  domainMax?: number;
};

const PAD = 3;

export function TraceRibbon({ trace, width = 480, compact = false, domainMax }: TraceRibbonProps) {
  if (!trace || trace.steps.length === 0) {
    return (
      <div role="img" aria-label="No trace data">
        <span className="italic text-xs text-zinc-500 dark:text-zinc-400">No trace data</span>
      </div>
    );
  }

  const { steps, truncated } = trace;
  const maxIndex = Math.max(...steps.map((s) => s.i));
  const axisMax = domainMax !== undefined ? Math.max(domainMax, maxIndex) : maxIndex;
  const xScale = scaleLinear({ domain: [0, axisMax], range: [PAD, width - PAD] });
  const slotWidth = axisMax > 0 ? (width - 2 * PAD) / (axisMax + 1) : width - 2 * PAD;

  const blockSteps = steps.filter((s) => blockKindOf(s) !== undefined);
  const callSteps = steps.filter((s): s is CallStep => s.kind === 'call');
  const turnSteps = steps.filter((s) => s.kind === 'turn');

  const lineHeight = compact ? 16 : 26;
  const blockHeight = compact ? 8 : 16;
  const turnRowHeight = compact ? 0 : 8;
  const gap = 3;
  const svgHeight = lineHeight + gap + blockHeight + (compact ? 0 : gap + turnRowHeight);
  const blockY = lineHeight + gap;
  const turnY = blockY + blockHeight + gap;

  const dataOpacity = truncated ? CONFIDENCE_OPACITY.medium : CONFIDENCE_OPACITY.high;

  const cumulativeValues = callSteps.map(cumulativeTokensOf);
  const maxCumulative = cumulativeValues.length > 0 ? Math.max(...cumulativeValues) : 0;
  const yLine = scaleLinear({
    domain: [0, maxCumulative > 0 ? maxCumulative : 1],
    range: [lineHeight - 2, 2],
  });

  // Kind legend + counts, in a fixed reading order, only for kinds actually
  // present in this trace's blocks -- an unused token never appears.
  const counts = new Map<KindKey, number>();
  for (const step of blockSteps) {
    const kind = blockKindOf(step);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const legendOrder: KindKey[] = [
    'model',
    'read',
    'write',
    'exec',
    'search',
    'plan',
    'agent',
    'web',
    'mcp',
    'harness-event',
    'error',
    'prose',
  ];
  const legendEntries = legendOrder
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));

  return (
    <div>
      {truncated && (
        <div className="mb-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <ConfidenceDot level="medium" />
          <span>Trace truncated — showing partial data</span>
        </div>
      )}
      <svg
        role="img"
        aria-label={`Trace ribbon, ${blockSteps.length} steps`}
        width="100%"
        viewBox={`0 0 ${width} ${svgHeight}`}
        height={svgHeight}
        preserveAspectRatio="none"
      >
        <Group>
          {callSteps.length > 0 ? (
            <>
              <LinePath
                data={callSteps}
                x={(s) => xScale(s.i)}
                y={(s) => yLine(cumulativeTokensOf(s))}
                stroke={KIND_COLOR.model}
                strokeWidth={1.25}
                fill="none"
                opacity={dataOpacity}
              />
              {callSteps.map((s) => (
                <circle
                  key={`cum-${s.i}`}
                  data-cumulative-for={s.i}
                  cx={xScale(s.i)}
                  cy={yLine(cumulativeTokensOf(s))}
                  r={1.25}
                  fill={KIND_COLOR.model}
                  opacity={dataOpacity}
                >
                  <title>{`${cumulativeTokensOf(s)} cumulative tokens at step ${s.i}`}</title>
                </circle>
              ))}
            </>
          ) : (
            <text
              x={PAD}
              y={lineHeight / 2 + 3}
              fontSize={9}
              className="fill-zinc-500 dark:fill-zinc-400"
            >
              No token usage reported
            </text>
          )}

          {blockSteps.map((step) => {
            const kind = blockKindOf(step);
            if (!kind) return null;
            return (
              <rect
                key={`block-${step.i}`}
                data-step-kind={kind}
                x={xScale(step.i)}
                y={blockY}
                width={Math.max(slotWidth * 0.86, 1)}
                height={blockHeight}
                fill={KIND_COLOR[kind]}
                opacity={dataOpacity}
              >
                <title>{stepDetail(step)}</title>
              </rect>
            );
          })}

          {!compact &&
            turnSteps.map((step) => (
              <line
                key={`turn-${step.i}`}
                data-turn-boundary={step.i}
                x1={xScale(step.i)}
                x2={xScale(step.i)}
                y1={turnY}
                y2={turnY + turnRowHeight}
                stroke="var(--border)"
                strokeWidth={1}
              >
                <title>{`Turn boundary at step ${step.i}`}</title>
              </line>
            ))}
        </Group>
      </svg>

      {!compact && legendEntries.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {legendEntries.map(({ kind, count }) => (
            <li key={kind} className="inline-flex items-center gap-1">
              <Tooltip content={`${KIND_LABEL[kind]}: ${count}`}>
                <span
                  aria-hidden
                  data-legend-swatch={kind}
                  className={`inline-block size-2 rounded-sm ${KIND_BG_CLASS[kind]}`}
                />
              </Tooltip>
              <span>
                {KIND_LABEL[kind]} ({count})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Exported for tests that need the same kind-resolution the component uses. */
export { blockKindOf as __internalBlockKindOf };
