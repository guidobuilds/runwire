import type { LanesResponse } from '@runwire/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { detect, rules } from './detections';
import short from './fixtures/short.json';
import { buildModel } from './model';
import { Toolbar, type ToolbarProps } from './toolbar';

function toolbarProps(): ToolbarProps {
  return {
    model: buildModel(short as LanesResponse),
    harness: 'Test',
    indicators: [],
    detections: [],
    contextThreshold: 85,
    findings: [],
    availableCount: 0,
    lanes: [],
    collapsed: new Set(),
    fullscreen: false,
    onIndicator: vi.fn(),
    onDetection: vi.fn(),
    onThreshold: vi.fn(),
    onFinding: vi.fn(),
    onCollapse: vi.fn(),
    onOpenNode: vi.fn(),
    onZoom: vi.fn(),
    onFit: vi.fn(),
    onFullscreen: vi.fn(),
  };
}

it.each([1, 2, 1198])('formats every summary count noun for %i', (count) => {
  const props = toolbarProps();
  const agent = props.model.agents[0];
  const col = props.model.cols[0];
  if (!agent || !col) throw new Error('missing fixture data');
  props.model = {
    ...props.model,
    callCount: count,
    agents: Array.from({ length: count }, () => agent),
    cols: Array.from({ length: count }, (_, index) => ({
      ...col,
      model: `model-${index}`,
      fails: 1,
    })),
  };
  render(<Toolbar {...props} />);
  const n = count.toLocaleString('en-US');
  const suffix = count === 1 ? '' : 's';
  expect(
    screen.getByText(
      `Test · ${n} call${suffix} · ${n} agent${suffix} · ${n} model${suffix} · ${n} failure${suffix}`,
    ),
  ).toBeInTheDocument();
});

it('describes Context % as the session maximum, including unknown context', async () => {
  const props = toolbarProps();
  props.model = {
    ...props.model,
    cols: props.model.cols.map((col, index) => ({
      ...col,
      contextPercent: index === 0 ? 92 : null,
    })),
  };
  const { rerender } = render(<Toolbar {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Indicators/ }));
  const context = await screen.findByRole('checkbox', { name: 'Context % max 92%' });
  expect(context.closest('label')).toHaveAttribute(
    'title',
    'Maximum context usage across all calls in this session; unknown model windows excluded.',
  );
  props.model = {
    ...props.model,
    cols: props.model.cols.map((col) => ({ ...col, contextPercent: null })),
  };
  rerender(<Toolbar {...props} />);
  expect(screen.getByRole('checkbox', { name: 'Context % unavailable' })).toBeInTheDocument();
});

it('explains detection sources, counts and numbered human-labeled findings', async () => {
  const user = userEvent.setup();
  const model = buildModel(short as LanesResponse);
  const findings = detect(model);
  const onFinding = vi.fn();
  const onZoom = vi.fn();
  const onFit = vi.fn();
  const onDetection = vi.fn();
  const onThreshold = vi.fn();
  render(
    <Toolbar
      model={model}
      harness="Test"
      indicators={[]}
      detections={rules.map((r) => r.id)}
      contextThreshold={85}
      findings={findings}
      availableCount={findings.length}
      lanes={[]}
      collapsed={new Set()}
      fullscreen={false}
      onIndicator={vi.fn()}
      onDetection={onDetection}
      onThreshold={onThreshold}
      onFinding={onFinding}
      onCollapse={vi.fn()}
      onOpenNode={vi.fn()}
      onZoom={onZoom}
      onFit={onFit}
      onFullscreen={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Zoom out' }));
  await user.click(screen.getByRole('button', { name: 'Zoom in' }));
  await user.click(screen.getByRole('button', { name: 'Fit' }));
  expect(onZoom).toHaveBeenNthCalledWith(1, 0.8);
  expect(onZoom).toHaveBeenNthCalledWith(2, 1.25);
  expect(onFit).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /Detections/ }));
  expect(screen.getByText('from model + call kind')).toBeInTheDocument();
  expect(screen.getByText('from Context %')).toBeInTheDocument();
  expect(screen.getByText('from Failures')).toBeInTheDocument();
  for (const rule of rules) {
    const count = rule.detect(model, 85).length;
    expect(
      screen.getByText(`${count} finding${count === 1 ? '' : 's'}`, {
        selector: `[data-rule="${rule.id}"]`,
      }),
    ).toBeInTheDocument();
  }
  const threshold = screen.getByRole('spinbutton', { name: 'Context threshold (%)' });
  expect(threshold.closest('[data-rule-row]')).toHaveTextContent('Context over threshold');
  fireEvent.change(threshold, { target: { value: '90' } });
  expect(onThreshold).toHaveBeenLastCalledWith(90);
  await user.click(screen.getByRole('checkbox', { name: /Context over threshold/ }));
  expect(onDetection).toHaveBeenCalledWith('context-threshold');
  const buttons = within(screen.getByRole('list', { name: 'Findings' })).getAllByRole('button');
  buttons.forEach((button, index) => {
    const finding = findings[index];
    if (!finding) throw new Error('missing finding');
    expect(button).toHaveTextContent(`${index + 1}. ${finding.text}`);
    expect(button).toHaveTextContent(`main · calls #${finding.from + 1}–#${finding.to + 1}`);
  });
  await user.click(buttons[0] as HTMLElement);
  expect(onFinding).toHaveBeenCalledWith(findings[0]);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Indicators/ }));
  expect(screen.queryByRole('list', { name: 'Agents' })).toBeNull();
});
