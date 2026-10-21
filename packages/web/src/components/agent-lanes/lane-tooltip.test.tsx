import type { LanesResponse } from '@runwire/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import short from './fixtures/short.json';
import { LaneTooltip } from './lane-tooltip';
import { buildModel } from './model';

describe('lane tooltip metadata', () => {
  it('renders cell metadata and Open, plus honest waiting and inactive gaps', () => {
    const model = buildModel(short as LanesResponse);
    const agent = model.agents[0];
    const column = agent?.cols.find((col) =>
      col.events.some((event) => event.kind === 'compaction'),
    );
    if (!agent || !column) throw new Error('fixture needs a compaction');
    const open = vi.fn();
    const props = { model, agentId: agent.id, column: column.index, x: 0, y: 0, onOpenNode: open };
    const { rerender } = render(<LaneTooltip {...props} />);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(`${agent.id} · Agent`);
    expect(tooltip).toHaveTextContent(`Calls ${column.index + 1}–${column.index + 1}`);
    expect(tooltip).toHaveTextContent(`Model: ${column.model}`);
    expect(tooltip).toHaveTextContent(`Context: ${column.contextPercent?.toFixed(1)}%`);
    expect(tooltip).toHaveTextContent(`${column.promptInput} input tokens`);
    expect(tooltip).toHaveTextContent(`Tools: ${column.tools} total`);
    expect(tooltip).toHaveTextContent(`Failures: ${column.fails}`);
    const event = column.events.find((item) => item.kind === 'compaction');
    expect(tooltip).toHaveTextContent(
      `${event?.kind === 'compaction' ? event.preTokens : ''} pre-tokens`,
    );
    expect(tooltip).toHaveTextContent('Previous idle:');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith(agent.id);
    const gap = agent.cols[1]?.index ?? 1;
    const sparse = {
      ...model,
      byId: new Map([
        [agent.id, { ...agent, cols: agent.cols.filter((col) => col.index !== gap) }],
      ]),
    };
    rerender(<LaneTooltip {...props} model={sparse} column={gap} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('waiting, another agent is running');
    rerender(<LaneTooltip {...props} column={model.callCount + 1} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('not running');
  });
});
