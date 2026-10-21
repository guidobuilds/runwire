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

export function formatCount(count: number, noun: string) {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

export function Toolbar(props: ToolbarProps) {
  const { model } = props;
  const id = useId();
  const counts = useMemo(
    () =>
      catalog.map((indicator) => {
        if (indicator.id !== 'context') return indicator.count(model).toLocaleString('en-US');
        const peak = model.cols.reduce<number | null>(
          (max, col) =>
            col.contextPercent === null ? max : Math.max(max ?? 0, col.contextPercent),
          null,
        );
        return peak === null ? 'unavailable' : `max ${Math.round(peak).toLocaleString('en-US')}%`;
      }),
    [model],
  );
  const summary = useMemo(() => {
    const models = new Set(model.cols.flatMap((col) => (col.model ? [col.model] : [])));
    return [
      props.harness,
      formatCount(model.callCount, 'call'),
      formatCount(model.agents.length, 'agent'),
      formatCount(models.size, 'model'),
      formatCount(
        model.cols.reduce((n, col) => n + col.fails, 0),
        'failure',
      ),
    ].join(' · ');
  }, [model, props.harness]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
      <p className="mr-auto truncate" title={summary}>
        {summary}
      </p>
      {!props.fullscreen ? (
        <p className="text-muted-foreground">Ctrl/⌘ + scroll to zoom · drag to pan</p>
      ) : null}
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
              title={
                indicator.id === 'context'
                  ? 'Maximum context usage across all calls in this session; unknown model windows excluded.'
                  : undefined
              }
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
              {indicator.name}{' '}
              <span className="ml-auto text-muted-foreground">{counts[index]}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger render={<Button size="sm" variant="outline" />}>
          <Search aria-hidden="true" /> Detections{' '}
          {props.detections.length
            ? `${props.findings.length.toLocaleString('en-US')} found`
            : `${props.availableCount.toLocaleString('en-US')} available`}
        </PopoverTrigger>
        <PopoverContent className="max-h-[70vh] w-96 max-w-[90vw] overflow-y-auto" align="end">
          <PopoverTitle>Detections</PopoverTitle>
          {rules.map((rule) => (
            <div key={rule.id} data-rule-row className="space-y-1">
              <label htmlFor={`${id}-${rule.id}`} className="flex items-start gap-2 text-xs">
                <Checkbox
                  id={`${id}-${rule.id}`}
                  checked={props.detections.includes(rule.id)}
                  onCheckedChange={() => props.onDetection(rule.id)}
                />
                <span>
                  {ruleNames[rule.id]}
                  <span className="block text-muted-foreground">
                    from{' '}
                    {rule.id === 'high-tier-mechanical'
                      ? 'model + call kind'
                      : rule.indicators
                          .map(
                            (source) => catalog.find((item) => item.id === source)?.name ?? source,
                          )
                          .join(' + ')}
                  </span>
                </span>
                <span data-rule={rule.id} className="ml-auto shrink-0">
                  {formatCount(rule.detect(model, props.contextThreshold).length, 'finding')}
                </span>
              </label>
              {rule.id === 'context-threshold' ? (
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
                      if (Number.isFinite(value) && value >= 0 && value <= 100)
                        props.onThreshold(value);
                    }}
                  />
                </label>
              ) : null}
            </div>
          ))}
          <Separator />
          <h3 className="font-medium">Findings</h3>
          {props.findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No findings with the enabled rules.</p>
          ) : null}
          <ul aria-label="Findings" className="space-y-1">
            {props.findings.map((finding, index) => (
              <li key={`${finding.agentId}:${finding.from}:${finding.to}:${finding.text}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  onClick={() => props.onFinding(finding)}
                >
                  <span>
                    <span className="block">
                      {index + 1}. {finding.text}
                    </span>
                    <span className="block text-muted-foreground">
                      {model.byId.get(finding.agentId)?.label ?? 'Agent'} · calls #
                      {finding.from + 1}–#{finding.to + 1}
                    </span>
                  </span>
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
