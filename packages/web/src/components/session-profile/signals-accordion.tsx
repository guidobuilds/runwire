import type { ApiSessionDetail, TokenField } from '@runwire/core';
import type { ReactNode } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSessionProfileSignals } from '@/queries/session-profile';
import { formatNumber } from './format';

export type SignalsAccordionProps = {
  sessionId: string;
  session: ApiSessionDetail;
  /** From the already-fetched agent graph node list (nodes.length - 1); null while unknown. */
  subagentCount: number | null;
  refresh?: number;
};

const SKELETON_ROW_KEYS = ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'] as const;
const DELEGATION_SHARE_FIELD: TokenField = 'output';

function percentage(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/** 1 - own[field]/inclusive[field]; "not comparable" when there is nothing to divide by. */
function delegationShare(session: ApiSessionDetail, field: TokenField): string {
  const inclusive = session.tokensInclusive[field];
  const own = session.tokensOwn[field];
  if (inclusive <= 0) return 'not comparable';
  return `${Math.round((1 - own / inclusive) * 100)}%`;
}

function SignalRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-right font-medium text-sm">{value}</dd>
    </div>
  );
}

function BadgeList({ items }: { items: readonly string[] }) {
  if (items.length === 0) return <>none</>;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </span>
  );
}

/** Collapsed-by-default accordion of waste-pattern signals (G5), a secondary
 * insight, not the hero. Fetches on mount regardless of expand state — the
 * query hook runs at this component's own render, independent of whether the
 * Accordion panel keeps its children mounted while collapsed. */
export function SignalsAccordion({
  sessionId,
  session,
  subagentCount,
  refresh = 0,
}: SignalsAccordionProps) {
  const query = useSessionProfileSignals(sessionId, { scope: 'tree', refresh });

  return (
    <Accordion>
      <AccordionItem value="harness-signals">
        <AccordionTrigger>Harness signals</AccordionTrigger>
        <AccordionContent>
          {query.isLoading ? (
            <div className="flex flex-col gap-2">
              {SKELETON_ROW_KEYS.map((key) => (
                <Skeleton className="h-6 w-full" key={key} />
              ))}
            </div>
          ) : null}

          {query.isError ? (
            <div
              className="flex items-center gap-3 rounded-md border border-destructive/40 p-3 text-sm"
              role="alert"
            >
              <span>Signals could not be loaded.</span>
              <Button
                onClick={() => void query.refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          ) : null}

          {query.data ? (
            <dl className="flex flex-col">
              <SignalRow
                label="Compactions — auto"
                value={formatNumber(query.data.compactions.auto)}
              />
              <SignalRow
                label="Compactions — manual"
                value={formatNumber(query.data.compactions.manual)}
              />
              <SignalRow
                label="Compactions — unknown trigger"
                value={formatNumber(query.data.compactions.unknown)}
              />
              <SignalRow label="Model changes" value={formatNumber(query.data.modelChanges)} />
              <SignalRow
                label="MCP calls"
                value={`${formatNumber(query.data.toolCalls.mcp)} / ${formatNumber(query.data.toolCalls.total)} (${percentage(query.data.toolCalls.mcp, query.data.toolCalls.total)})`}
              />
              <SignalRow label="MCP servers" value={<BadgeList items={query.data.mcpServers} />} />
              <SignalRow label="Skill calls" value={formatNumber(query.data.skillCalls)} />
              <SignalRow label="Skills used" value={<BadgeList items={query.data.skillNames} />} />
              <SignalRow
                label="Delegation share"
                value={delegationShare(session, DELEGATION_SHARE_FIELD)}
              />
              <SignalRow
                label="Subagents"
                value={subagentCount === null ? '—' : formatNumber(subagentCount)}
              />
            </dl>
          ) : null}

          <p className="mt-3 text-muted-foreground text-xs">
            Expensive-model-on-cheap-work is not assessed: Runwire has no model cost tier.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
