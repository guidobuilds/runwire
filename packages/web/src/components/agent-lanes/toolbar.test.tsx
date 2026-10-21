import type { LanesResponse } from '@runwire/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import short from './fixtures/short.json';
import { buildModel } from './model';
import { Toolbar, type ToolbarProps } from './toolbar';

function mount() {
  const props: ToolbarProps = {
    model: buildModel(short as LanesResponse),
    harness: 'Test harness',
    indicators: [],
    detections: [],
    contextThreshold: 85,
    findings: [],
    availableCount: 2,
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
  render(<Toolbar {...props} />);
  return props;
}

describe('lanes toolbar', () => {
  it('exposes detection sources, edits the threshold, and preserves zoom and Fit actions', async () => {
    const user = userEvent.setup();
    const props = mount();
    expect(screen.getByText(/Test harness.*calls.*agents.*models.*failures/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Fit' }));
    expect(props.onZoom).toHaveBeenNthCalledWith(1, 0.8);
    expect(props.onZoom).toHaveBeenNthCalledWith(2, 1.25);
    expect(props.onFit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: /Detections 2 available/ }));
    await user.click(screen.getByRole('checkbox', { name: /Context over threshold/ }));
    expect(props.onDetection).toHaveBeenCalledWith('context-threshold');
    expect(screen.getByText('Source: context')).toBeInTheDocument();
    const threshold = screen.getByRole('spinbutton', { name: 'Context threshold (%)' });
    fireEvent.change(threshold, { target: { value: '90' } });
    expect(props.onThreshold).toHaveBeenLastCalledWith(90);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
