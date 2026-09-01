import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Capability, SessionSummary } from '../../api/types';
import { formatGit, shortId } from '../../lib/format';
import { usePrefs } from '../../state/prefs';
import { PageHeading } from '../PageHeading';
import { Badge, type BadgeTone } from '../primitives/Badge';
import { MetricCell } from '../primitives/MetricCell';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '../ui/popover';
import { clampText, formatVersionRange } from './text';

export type SessionHeaderProps = {
  summary: SessionSummary;
  /**
   * Hoisted once by the route and passed down (design.md §5/§6/§7). `undefined`
   * while `GET /api/status` resolves; every cell here is the pure `MetricCell`,
   * so the whole detail view holds 2 query observers, not 2 per cell.
   */
  capabilities: readonly Capability[] | undefined;
  displayName: string;
};

const IDENTITY_TONE: Record<SessionSummary['project']['identity'], BadgeTone> = {
  remote: 'info',
  'repo-root': 'neutral',
  cwd: 'neutral',
};

/**
 * Model-change popover (design.md §5: "models with change-count popover").
 * The always-visible `MetricCell` next to this shows the primary model; this
 * is only rendered when the session actually changed models mid-run
 * (`model.changes > 0`), so a single-model session (the overwhelming common
 * case) never pays for a popover trigger it has no content for. The full
 * model list stays reachable — just behind one click instead of always
 * inline — which is the point of a popover over a permanently-expanded list
 * for a fact only a minority of sessions have.
 */
function ModelChangesPopover({ models, changes }: { models: readonly string[]; changes: number }) {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex">
        <Badge tone="warn">{`${changes} ${changes === 1 ? 'change' : 'changes'}`}</Badge>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <PopoverHeader>
          <PopoverTitle>Models used</PopoverTitle>
        </PopoverHeader>
        <ul className="space-y-0.5 font-mono text-xs">
          {models.map((model) => (
            <li key={model}>{model}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-800 dark:text-zinc-100">
        {children}
      </dd>
    </div>
  );
}

/**
 * Header facts for one session (design.md §7). An operational review: no
 * transcript content beyond `title`, which is the single content-derived field
 * (D7) and is therefore gated on the shell's Titles preference.
 *
 * Two object-valued summary fields land here — `title` (`{ value,
 * contentDerived }`) and `harnessVersion` (`{ first, last }`). Neither is a
 * `Metric`, and neither is handed to `MetricCell` as a value: `title` renders
 * its `.value` string and `harnessVersion` renders as a version range, so the
 * raw-JSON fallback (BL-1's residual, BL-18's unbounded cell) is never on the
 * path. When either is absent, an empty `MetricCell` renders the shared absence
 * glyph so `n/a` and `—` keep meaning the same thing here as in every session
 * list.
 */
export function SessionHeader({ summary, capabilities, displayName }: SessionHeaderProps) {
  const prefs = usePrefs();
  const harness = summary.harness;
  const titleText = prefs.showTitles ? (summary.title?.value.trim() ?? '') : '';
  const gitText = summary.git ? formatGit(summary.git) : '';
  const versionText = formatVersionRange(summary.harnessVersion);
  const otherCwds = Math.max(0, summary.cwd.all.length - 1);

  return (
    <header className="space-y-4">
      <PageHeading
        eyebrow={displayName}
        title={titleText === '' ? shortId(summary.id) : clampText(titleText)}
        titleAttr={titleText === '' ? undefined : titleText}
        description={<span className="font-mono text-xs">{summary.id}</span>}
      />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Fact label="Project">
          <Link
            to="/projects/$key"
            params={{ key: summary.project.key }}
            className="font-medium underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500 dark:decoration-zinc-600"
          >
            {summary.project.name}
          </Link>
          <Badge tone={IDENTITY_TONE[summary.project.identity]}>{summary.project.identity}</Badge>
          {summary.project.worktree ? (
            <Badge tone="info">{`worktree: ${summary.project.worktree}`}</Badge>
          ) : null}
        </Fact>

        <Fact label="Working directory">
          <span className="font-mono text-xs" title={summary.cwd.first}>
            {clampText(summary.cwd.first)}
          </span>
          {otherCwds > 0 ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {`+${otherCwds} other ${otherCwds === 1 ? 'cwd' : 'cwds'}`}
            </span>
          ) : null}
        </Fact>

        <Fact label="Harness">
          <span>{displayName}</span>
          {versionText === '' ? (
            <MetricCell
              field="harnessVersion"
              harness={harness}
              capabilities={capabilities}
              displayName={displayName}
            />
          ) : (
            <span className="font-mono text-xs">{versionText}</span>
          )}
          {summary.flags.versionChanged ? <Badge tone="warn">version changed</Badge> : null}
        </Fact>

        <Fact label="Repository">
          {gitText === '' ? (
            <MetricCell
              field="git"
              harness={harness}
              capabilities={capabilities}
              displayName={displayName}
            />
          ) : (
            <span className="font-mono text-xs">{gitText}</span>
          )}
        </Fact>

        <Fact label="Started">
          <MetricCell
            field="startedAt"
            harness={harness}
            metric={summary.timing.startedAt}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Fact>

        <Fact label="Ended">
          <MetricCell
            field="endedAt"
            harness={harness}
            metric={summary.timing.endedAt}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Fact>

        <Fact label="Duration">
          <MetricCell
            field="durationMs"
            harness={harness}
            metric={summary.timing.durationMs}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Fact>

        <Fact label="Cost">
          <MetricCell
            field="cost"
            harness={harness}
            metric={summary.cost}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Fact>

        <Fact label="Model">
          <MetricCell
            field="model"
            harness={harness}
            metric={summary.model.primary}
            capabilities={capabilities}
            displayName={displayName}
          />
          {summary.model.changes > 0 ? (
            <ModelChangesPopover models={summary.model.all} changes={summary.model.changes} />
          ) : summary.model.all.length > 1 ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {summary.model.all.join(', ')}
            </span>
          ) : null}
        </Fact>

        <Fact label="Mode">
          <MetricCell
            field="mode"
            harness={harness}
            metric={summary.mode?.primary}
            capabilities={capabilities}
            displayName={displayName}
          />
          {summary.mode && summary.mode.changes > 0 ? (
            <Badge tone="warn">{`${summary.mode.changes} changes`}</Badge>
          ) : null}
          {summary.mode && summary.mode.all.length > 1 ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {summary.mode.all.join(', ')}
            </span>
          ) : null}
        </Fact>

        <Fact label="Effort">
          <MetricCell
            field="effort"
            harness={harness}
            metric={summary.effort}
            capabilities={capabilities}
            displayName={displayName}
          />
        </Fact>

        <Fact label="Lineage">
          <Badge tone="neutral">{summary.relation ?? 'root'}</Badge>
          {summary.agentType ? <Badge tone="info">{summary.agentType}</Badge> : null}
          {summary.flags.resumed ? <Badge tone="neutral">resumed</Badge> : null}
          {summary.flags.forkedFrom ? (
            <Badge tone="neutral">{`forked from ${shortId(summary.flags.forkedFrom)}`}</Badge>
          ) : null}
        </Fact>
      </dl>
    </header>
  );
}
