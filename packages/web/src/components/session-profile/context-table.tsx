import type { ProfileContextDescendant } from '@runwire/core';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSessionProfileContext } from '@/queries/session-profile';
import {
  formatCompact,
  formatCurrency,
  formatDuration,
  readableAgent,
  readableModel,
} from './format';

export type ContextTableProps = {
  sessionId: string;
  refresh?: number;
};

const COUNT_FORMATTER = new Intl.NumberFormat();
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
});

/** `null` means the source never reported this prompt input; render an em dash. */
function formatPromptMetric(value: number | null): string {
  return value === null ? '—' : formatCompact(value);
}

function formatCacheShare(value: number | null): string {
  return value === null ? '—' : PERCENT_FORMATTER.format(value);
}

/** Last `/`-separated segment, used when a descendant declares no agent type. */
function shortId(id: string): string {
  const parts = id.split('/');
  return parts[parts.length - 1] ?? id;
}

function agentLabel(node: ProfileContextDescendant): string {
  return node.agentType === null ? shortId(node.id) : readableAgent(node.agentType);
}

const COLUMNS = [
  'Agent',
  'Duration',
  'Model',
  'Calls',
  'Avg prompt',
  'P95 prompt',
  'Peak prompt',
  'Cache read',
  'Prompt input',
  'Cost',
] as const;

function ContextRow({ node }: { node: ProfileContextDescendant }) {
  const metrics = node.metrics;
  return (
    <TableRow>
      <TableCell style={{ paddingLeft: `${(node.relativeDepth - 1) * 16 + 8}px` }}>
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          params={{ id: node.id }}
          to="/sessions/$id"
        >
          {agentLabel(node)}
        </Link>
      </TableCell>
      <TableCell>{formatDuration(node.durationMs)}</TableCell>
      <TableCell>{node.modelPrimary === null ? '—' : readableModel(node.modelPrimary)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {COUNT_FORMATTER.format(metrics.observedCalls)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPromptMetric(metrics.avgPromptInput)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPromptMetric(metrics.p95PromptInput)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPromptMetric(metrics.peakPromptInput)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCacheShare(metrics.cacheReadShare)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPromptMetric(metrics.promptInput)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatCurrency(node.costUsd)}</TableCell>
    </TableRow>
  );
}

/** Descendant-subsession context comparison, mounted after the agent graph.
 * Renders nothing until a successful response actually carries descendants, and
 * preserves the endpoint's own depth-first order (no client re-sorting). */
export function ContextTable({ sessionId, refresh = 0 }: ContextTableProps) {
  const query = useSessionProfileContext(sessionId, { refresh });
  const descendants = query.data?.descendants ?? [];
  if (descendants.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold text-lg">Subagent context</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {descendants.map((node) => (
                <ContextRow key={node.id} node={node} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
