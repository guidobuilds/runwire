import { ChartLine, Maximize2, Minimize2, Minus, Plus, Search } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { type Finding, type RuleId, rules } from './detections';
import { indicators as catalog } from './indicators';
import type { LaneModelData } from './model';
import type { LanePlacement } from './renderer/layout';

const ruleNames: Record<RuleId, string> = {
  'high-tier-mechanical': 'High-tier mechanical work',
  'context-threshold': 'Context over threshold',
  'failure-group': 'Failure group',
};

export type ToolbarProps = {
  model: LaneModelData;
  harness: string;
  indicators: readonly string[];
  detections: readonly RuleId[];
  contextThreshold: number;
  findings: readonly Finding[];
  availableCount: number;
  lanes: readonly LanePlacement[];
  collapsed: ReadonlySet<string>;
  fullscreen: boolean;
  onIndicator: (id: string) => void;
  onDetection: (id: RuleId) => void;
  onThreshold: (value: number) => void;
  onFinding: (finding: Finding) => void;
  onCollapse: (id: string) => void;
  onOpenNode: (id: string) => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onFullscreen: () => void;
};

export function Toolbar(props: ToolbarProps) {
  const { model } = props;
  const id = useId();
  const counts = useMemo(() => catalog.map((indicator) => indicator.count(model)), [model]);
  const summary = useMemo(() => {
    const models = new Set(model.cols.flatMap((col) => (col.model ? [col.model] : [])));
    return `${props.harness} · ${model.callCount} calls · ${model.agents.length} agents · ${models.size} models · ${model.cols.reduce((n, col) => n + col.fails, 0)} failures`;
  }, [model, props.harness]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <p className="mr-auto truncate" title={summary}>
        {summary}
      </p>
      <Popover>
        <PopoverTrigger render={<Button size="sm" variant="outline" />}>
          <ChartLine aria-hidden="true" /> Indicators {props.indicators.length}/{catalog.length}
        </PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto" align="end">
          <PopoverTitle>Indicators</PopoverTitle>
          {catalog.map((indicator, index) => (
            <label
              key={indicator.id}
              htmlFor={`${id}-${indicator.id}`}
              className="flex items-center gap-2 text-xs"
            >
              <Checkbox
                id={`${id}-${indicator.id}`}
                checked={props.indicators.includes(indicator.id)}
                onCheckedChange={() => props.onIndicator(indicator.id)}
              />
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: `var(${indicator.colorToken})` }}
              />
              {indicator.name}
              <span className="ml-auto text-muted-foreground">{counts[index]}</span>
            </label>
          ))}
          <Separator />
          <h3 className="font-medium">Agents</h3>
          <ul aria-label="Agents" className="space-y-1">
            {props.lanes.map(({ agent, hidden }) => (
              <li
                key={agent.id}
                className="flex items-center gap-1"
                style={{ paddingLeft: Math.min(5, agent.depth) * 8 }}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${props.collapsed.has(agent.id) ? 'Expand' : 'Collapse'} ${agent.id}`}
                  aria-expanded={!props.collapsed.has(agent.id)}
                  onClick={() => props.onCollapse(agent.id)}
                >
                  {agent.agentType ?? agent.id}
                  {hidden ? ` +${hidden} hidden` : ''}
                </Button>
                <Button
                  size="sm"
                  variant="link"
                  aria-label={`Open ${agent.id}`}
                  onClick={() => props.onOpenNode(agent.id)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger render={<Button size="sm" variant="outline" />}>
          <Search aria-hidden="true" /> Detections{' '}
          {props.detections.length
            ? `${props.findings.length} found`
            : `${props.availableCount} available`}
        </PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-96 max-w-[90vw] overflow-y-auto" align="end">
          <PopoverTitle>Detections</PopoverTitle>
          {rules.map((rule) => (
            <label
              key={rule.id}
              htmlFor={`${id}-${rule.id}`}
              className="flex items-start gap-2 text-xs"
            >
              <Checkbox
                id={`${id}-${rule.id}`}
                checked={props.detections.includes(rule.id)}
                onCheckedChange={() => props.onDetection(rule.id)}
              />
              <span>
                {ruleNames[rule.id]}
                <span className="block text-muted-foreground">
                  Source: {rule.indicators.join(', ')}
                </span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs">
            Context threshold (%)
            <input
              type="number"
              min="0"
              max="100"
              value={props.contextThreshold}
              className="w-16 rounded border bg-background px-2 py-1"
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value >= 0 && value <= 100) props.onThreshold(value);
              }}
            />
          </label>
          <Separator />
          <h3 className="font-medium">Findings</h3>
          {props.findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No findings with the enabled rules.</p>
          ) : null}
          <ul aria-label="Findings" className="space-y-1">
            {props.findings.map((finding) => (
              <li key={`${finding.agentId}:${finding.from}:${finding.to}:${finding.text}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  onClick={() => props.onFinding(finding)}
                >
                  {finding.agentId}: {finding.text} (calls {finding.from + 1}–{finding.to + 1})
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <fieldset aria-label="Zoom" className="flex items-center">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom out"
          onClick={() => props.onZoom(0.8)}
        >
          <Minus />
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onFit}>
          Fit
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom in"
          onClick={() => props.onZoom(1.25)}
        >
          <Plus />
        </Button>
      </fieldset>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={props.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={props.onFullscreen}
      >
        {props.fullscreen ? <Minimize2 /> : <Maximize2 />}
      </Button>
    </div>
  );
}
