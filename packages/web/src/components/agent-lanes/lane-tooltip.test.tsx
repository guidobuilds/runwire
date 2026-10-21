import type { LanesResponse } from '@runwire/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import short from './fixtures/short.json';
import { LaneTooltip } from './lane-tooltip';
import { buildModel } from './model';

function fixture(idle = 17 * 60 * 60_000) {
  const data = structuredClone(short) as LanesResponse;
  const agent = data.agents[0];
  const model = data.models[0];
  if (!agent || !model) throw new Error('missing fixture');
  agent.id = 'private-session-id';
  agent.agentType = 'namespace:worker';
  model.contextWindow = 400_000;
  agent.calls.at[0] = '2026-01-01T00:00:00Z';
  agent.calls.at[1] = new Date(Date.parse(agent.calls.at[0]) + idle).toISOString();
  agent.calls.promptInput[1] = 250_000;
  agent.calls.model[1] = 0;
  agent.calls.failed[1] = 0;
  agent.calls.mcp[1] = 0;
  agent.calls.skill[1] = 0;
  agent.calls.spawns[1] = [];
  agent.calls.kind[1] = 'exec';
  agent.calls.tools[1] = 2;
  agent.calls.events[1] = [
    { kind: 'compaction', trigger: 'auto', preTokens: 300_000, postTokens: 250_000 },
  ];
  // Keep these two calls in global order independently of the fixture's later dates.
  for (let i = 2; i < agent.calls.at.length; i++) {
    agent.calls.at[i] = new Date(Date.parse(agent.calls.at[1]) + i * 1000).toISOString();
  }
  return buildModel(data);
}

describe('LaneTooltip', () => {
  it('formats metadata, suppresses zeros, and exposes an interactive Open action', () => {
    const model = fixture();
    const open = vi.fn();
    render(
      <LaneTooltip
        model={model}
        agentId="private-session-id"
        column={1}
        x={200}
        y={50}
        onOpenNode={open}
      />,
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('main · namespace:worker');
    expect(tooltip).toHaveTextContent('Calls #2–#2');
    expect(tooltip).toHaveTextContent('62.5% · 250k');
    expect(tooltip).toHaveTextContent('window 400k');
    expect(tooltip).toHaveTextContent('exec 2');
    expect(tooltip).toHaveTextContent('Previous idle: 17h');
    expect(tooltip).toHaveTextContent('Model: claude-opus-5-5');
    expect(tooltip).toHaveTextContent('Compaction (auto): 300k pre-tokens → 250k post-tokens');
    expect(tooltip).not.toHaveTextContent('private-session-id');
    expect(tooltip).not.toHaveTextContent('Failures:');
    expect(tooltip).not.toHaveTextContent('0 MCP');
    expect(tooltip).toHaveStyle({ pointerEvents: 'auto' });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith('private-session-id');
  });

  it('preserves waiting and inactive gap explanations', () => {
    const model = fixture();
    const agent = model.agents[0];
    if (!agent) throw new Error('missing agent');
    const sparse = {
      ...model,
      byId: new Map([[agent.id, { ...agent, cols: agent.cols.filter((col) => col.index !== 1) }]]),
    };
    const props = { agentId: agent.id, column: 1, x: 0, y: 0, onOpenNode: vi.fn() };
    const { rerender } = render(<LaneTooltip {...props} model={sparse} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('waiting, another agent is running');
    rerender(<LaneTooltip {...props} model={model} column={model.callCount + 1} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('not running');
  });

  it.each([0, 3_000, 30 * 60_000])('hides idle at or below 30 minutes (%s)', (idle) => {
    render(
      <LaneTooltip
        model={fixture(idle)}
        agentId="private-session-id"
        column={1}
        x={200}
        y={50}
        onOpenNode={vi.fn()}
      />,
    );
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Previous idle');
  });
});
