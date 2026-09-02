import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { AgentSpan, ComponentEvent, HarnessEvent, TokenPoint } from '../../lib/timeline';
import { EventInspector } from './EventInspector';
import { TimelineProvider, useTimeline } from './TimelineContext';

afterEach(() => cleanup());

function rootSpan(): AgentSpan {
  return {
    id: 'root',
    agentId: 'root',
    name: 'root',
    parentAgentId: null,
    depth: 0,
    start: 0,
    end: 600_000,
    model: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    confidenceLevel: 'high',
  };
}

function span(overrides: Partial<AgentSpan> = {}): AgentSpan {
  return {
    id: 'agent-x',
    agentId: 'agent-x',
    name: 'Explore',
    parentAgentId: 'root',
    depth: 1,
    start: 65_000, // 1:05
    end: 125_000, // 2:05, duration 60_000 -> 1:00
    model: 'claude-explore',
    inputTokens: 500,
    outputTokens: 300,
    confidenceLevel: 'high',
    ...overrides,
  };
}

function point(overrides: Partial<TokenPoint> = {}): TokenPoint {
  return {
    id: 'call:s1#0',
    agentId: 's1',
    at: 61_000, // 1:01
    cumulative: 100,
    delta: 40,
    input: 25,
    output: 15,
    model: 'claude-x',
    ...overrides,
  };
}

function harnessEvent(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    id: 's1#0',
    agentId: 's1',
    kind: 'exec',
    at: 1000, // 0:01
    durationMs: 2500,
    name: 'npm test',
    error: undefined,
    ...overrides,
  };
}

function componentEvent(overrides: Partial<ComponentEvent> = {}): ComponentEvent {
  return {
    id: 's1#1',
    agentId: 's1',
    kind: 'mcp',
    at: 100,
    durationMs: 1500,
    name: 'mcp__github__search',
    detail: 'github/search',
    childId: undefined,
    ...overrides,
  };
}

const SPANS = [rootSpan(), span()];
const POINTS = [point()];
const HARNESS_EVENTS = [harnessEvent()];
const COMPONENT_EVENTS = [componentEvent()];

function SelectButton({ id }: { id: string }) {
  const { selectEvent } = useTimeline();
  return (
    <button type="button" onClick={() => selectEvent(id)}>
      select {id}
    </button>
  );
}

function SelectionReadout() {
  const { selectedEventId } = useTimeline();
  return <div data-testid="selection">{selectedEventId ?? 'null'}</div>;
}

function renderInspector() {
  return render(
    <TimelineProvider domain={[0, 600_000]}>
      <EventInspector
        spans={SPANS}
        tokenPoints={POINTS}
        harnessEvents={HARNESS_EVENTS}
        componentEvents={COMPONENT_EVENTS}
      />
      <SelectButton id="agent-x" />
      <SelectButton id="call:s1#0" />
      <SelectButton id="s1#0" />
      <SelectButton id="s1#1" />
      <SelectButton id="does-not-exist" />
      <SelectionReadout />
    </TimelineProvider>,
  );
}

describe('open/closed state', () => {
  test('no Sheet is present when selectedEventId is null', () => {
    renderInspector();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Agent event', () => {
  test('selecting an AgentSpan opens the Sheet with name/start-end/duration/tokens/model/parent fields', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select agent-x'));
    expect(await screen.findByRole('dialog')).not.toBeNull();

    expect(screen.getByText('Agent: Explore')).not.toBeNull();
    expect(screen.getByText('Explore')).not.toBeNull();
    expect(screen.getByText('1:05')).not.toBeNull(); // Start
    expect(screen.getByText('2:05')).not.toBeNull(); // End
    expect(screen.getByText('1:00')).not.toBeNull(); // Duration
    expect(screen.getByText('500 in / 300 out')).not.toBeNull(); // Tokens
    expect(screen.getByText('claude-explore')).not.toBeNull(); // Model
    expect(screen.getByText('root')).not.toBeNull(); // Parent (resolved via spansById)
  });
});

describe('Token event', () => {
  test('selecting a TokenPoint opens the Sheet with timestamp/cumulative/delta/input/output/agent/model fields', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select call:s1#0'));
    expect(await screen.findByRole('dialog')).not.toBeNull();

    expect(screen.getByText('Token call')).not.toBeNull();
    expect(screen.getByText('1:01')).not.toBeNull(); // Timestamp
    expect(screen.getByText('100')).not.toBeNull(); // Cumulative
    expect(screen.getByText('40')).not.toBeNull(); // Delta
    expect(screen.getByText('25')).not.toBeNull(); // Input
    expect(screen.getByText('15')).not.toBeNull(); // Output
    expect(screen.getByText('s1')).not.toBeNull(); // Agent
    expect(screen.getByText('claude-x')).not.toBeNull(); // Model
  });
});

describe('Harness event', () => {
  test('selecting a HarnessEvent opens the Sheet with type/start-end/duration/target/agent fields', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select s1#0'));
    expect(await screen.findByRole('dialog')).not.toBeNull();

    expect(screen.getByText('Harness: Exec')).not.toBeNull();
    expect(screen.getByText('0:01')).not.toBeNull(); // Start
    expect(screen.getByText('0:03')).not.toBeNull(); // End (1000 + 2500 = 3500ms)
    expect(screen.getByText('2.5s')).not.toBeNull(); // Duration
    expect(screen.getByText('npm test')).not.toBeNull(); // Target
  });
});

describe('Component event', () => {
  test('selecting a ComponentEvent opens the Sheet with agent/operation/server-tool-detail/duration fields, no tokens line', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select s1#1'));
    expect(await screen.findByRole('dialog')).not.toBeNull();

    expect(screen.getByText('Component: MCP')).not.toBeNull();
    expect(screen.getByText('MCP — mcp__github__search')).not.toBeNull(); // Operation
    expect(screen.getByText('github/search')).not.toBeNull(); // Detail
    expect(screen.getByText('1.5s')).not.toBeNull(); // Duration
    expect(screen.queryByText(/^Tokens$/)).toBeNull(); // never a fake tokens line
  });
});

describe('raw metadata block', () => {
  test('a collapsible <details> block carries the full source event object as JSON', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select agent-x'));
    await screen.findByRole('dialog');

    const details = document.querySelector('[data-slot="raw-metadata"]');
    expect(details?.tagName).toBe('DETAILS');
    expect(screen.getByText('Raw metadata')).not.toBeNull();
    const pre = details?.querySelector('pre');
    expect(pre).not.toBeNull();
    const parsed = JSON.parse(pre?.textContent ?? '{}');
    expect(parsed).toEqual(span());
  });
});

describe('closing', () => {
  test('clicking the close button clears TimelineContext.selectedEventId', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select agent-x'));
    await screen.findByRole('dialog');
    expect(screen.getByTestId('selection').textContent).toBe('agent-x');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.getByTestId('selection').textContent).toBe('null');
    });
  });

  test('selecting a different mark while open switches the shown event', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select agent-x'));
    await screen.findByRole('dialog');
    expect(screen.getByText('Agent: Explore')).not.toBeNull();

    fireEvent.click(screen.getByText('select s1#0'));
    expect(screen.getByText('Harness: Exec')).not.toBeNull();
    expect(screen.queryByText('Agent: Explore')).toBeNull();
  });
});

describe('unresolvable selection', () => {
  test('a selectedEventId matching no known event shows a not-found state instead of crashing', async () => {
    renderInspector();
    fireEvent.click(screen.getByText('select does-not-exist'));
    expect(await screen.findByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Event not found')).not.toBeNull();
  });
});
