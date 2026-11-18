import type { LanesResponse } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSessionProfileLanes } from '@/lib/api/session-profile';
import { server } from '@/mocks/node';
import { AgentLanes } from './agent-lanes';
import nested from './fixtures/nested.json';
import short from './fixtures/short.json';
import { drawFrame } from './renderer/draw';

vi.mock('./renderer/draw', async (original) => ({
  ...(await original<typeof import('./renderer/draw')>()),
  drawFrame: vi.fn(),
}));

function mount(id = 'sess-1') {
  const onOpenNode = vi.fn();
  const onNodeCount = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentLanes sessionId={id} onOpenNode={onOpenNode} onNodeCount={onNodeCount} />
    </QueryClientProvider>,
  );
  return { onOpenNode, onNodeCount, queryClient };
}

beforeEach(() => {
  localStorage.clear();
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.style.contain === 'inline-size'
      ? new DOMRect(0, 0, 900, 448)
      : originalRect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Agent Lanes', () => {
  it('provides theme-independent pan cursors and isolates the canvas from wrapper sizing', async () => {
    mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(canvas).toHaveClass('cursor-grab', 'active:cursor-grabbing', 'absolute');
    expect(canvas.parentElement).toHaveClass('min-w-0', 'w-full');
    expect(canvas.parentElement).toHaveStyle({ contain: 'inline-size' });
  });

  it('explains inline zoom only outside fullscreen and formats the accessible summary', async () => {
    const user = userEvent.setup();
    mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(canvas).toHaveAccessibleName(/1 agent,.*findings/);
    expect(screen.getByText('Ctrl/⌘ + scroll to zoom · drag to pan')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(screen.queryByText('Ctrl/⌘ + scroll to zoom · drag to pan')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByText('Ctrl/⌘ + scroll to zoom · drag to pan')).toBeInTheDocument();
  });

  it('observes the isolated wrapper and remeasures fullscreen exit and sidebar transitions', async () => {
    const user = userEvent.setup();
    let width = 900;
    let height = 448;
    let notify = () => {};
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.style.contain === 'inline-size'
        ? new DOMRect(0, 0, width + 0.5, height)
        : new DOMRect();
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(observe).toHaveBeenCalledWith(canvas.parentElement);
    const drawnSize = () => vi.mocked(drawFrame).mock.calls.at(-1)?.[2];
    await waitFor(() => expect(drawnSize()).toMatchObject({ width: 900, height: 178 }));
    width = 1600;
    height = 900;
    await user.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    await waitFor(() => expect(drawnSize()).toMatchObject({ width: 1600, height: 900 }));
    width = 900;
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawnSize()).toMatchObject({ width: 900, height: 178 }));
    width = 700;
    act(() => notify());
    await waitFor(() => expect(drawnSize()).toMatchObject({ width: 700, height: 178 }));
    width = 1000;
    fireEvent.transitionEnd(document.body);
    await waitFor(() => expect(drawnSize()).toMatchObject({ width: 1000, height: 178 }));
  });

  it('starts with quiet defaults and mounts the live legend', async () => {
    mount();
    await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(screen.getByRole('button', { name: /Indicators 6\/8/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detections \d+ available/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('agent-lanes:detections') ?? 'null')).toEqual([]);
    expect(localStorage.getItem('agent-lanes:threshold')).toBe('85');
    const enabled = JSON.parse(localStorage.getItem('agent-lanes:indicators') ?? '[]');
    expect(enabled).toHaveLength(6);
    expect(enabled).not.toContain('skills');
    expect(enabled).not.toContain('mcp');
    expect(screen.getByRole('region', { name: 'Agent lanes legend' })).toHaveTextContent(
      '1 column = 1 call',
    );
  });

  it('updates the legend bucket size after zooming', async () => {
    const user = userEvent.setup();
    mount('nested');
    await screen.findByLabelText(/Agent lanes:.*calls/);
    const legend = screen.getByRole('region', { name: 'Agent lanes legend' });
    await waitFor(() => expect(legend).toHaveTextContent('1 column = 4 calls'));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(legend).toHaveTextContent('1 column = 2 calls'));
  });

  it('preserves stored preferences', async () => {
    localStorage.setItem('agent-lanes:indicators', JSON.stringify(['skills', 'mcp']));
    localStorage.setItem('agent-lanes:detections', JSON.stringify(['failure-group']));
    localStorage.setItem('agent-lanes:threshold', '90');
    mount();
    await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(screen.getByRole('button', { name: /Indicators 2\/8/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detections \d+ found/ })).toBeInTheDocument();
    expect(localStorage.getItem('agent-lanes:threshold')).toBe('90');
  });
  it('loads the MSW lanes and preserves count, accessible summary and menu controls', async () => {
    const user = userEvent.setup();
    const { onNodeCount } = mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    expect(canvas).toHaveAttribute('tabindex', '0');
    expect(onNodeCount).toHaveBeenCalledWith(0);
    await user.click(screen.getByRole('button', { name: /Indicators/ }));
    const checkbox = screen.getByRole('checkbox', { name: /Context %/ });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    await waitFor(() =>
      expect(drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ enabledIndicators: expect.not.arrayContaining(['context']) }),
        expect.anything(),
      ),
    );
    expect(JSON.parse(localStorage.getItem('agent-lanes:indicators') ?? '[]')).not.toContain(
      'context',
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Indicators/ }));
    await user.click(canvas);
    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
  });

  it('expands and focuses a finding and collapses only parents in the label column', async () => {
    const user = userEvent.setup();
    const { onNodeCount } = mount('nested');
    await screen.findByLabelText(/Agent lanes:/);
    expect(onNodeCount).toHaveBeenCalledWith(nested.agents.length - 1);
    const parent = nested.agents.find((agent) => agent.id === 'sub-3');
    if (!parent) throw new Error('missing parent');
    const { buildModel } = await import('./model');
    const labels = buildModel(nested as LanesResponse);
    const label = labels.byId.get('sub-3')?.label;
    await user.click(screen.getByRole('button', { name: `Collapse ${label}` }));
    expect(screen.getByRole('button', { name: `Expand ${label}` })).toHaveTextContent('+5 hidden');
    const leaf = labels.agents.find((agent) => !labels.children.get(agent.id)?.length);
    expect(screen.queryByRole('button', { name: `Collapse ${leaf?.label}` })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Detections/ }));
    await user.click(screen.getByRole('checkbox', { name: /Context over threshold/ }));
    await user.click(screen.getByRole('checkbox', { name: /Failure group/ }));
    await user.click(screen.getByRole('checkbox', { name: /High-tier mechanical work/ }));
    const findings = screen.getByRole('list', { name: 'Findings' });
    const finding = within(findings)
      .getAllByRole('button')
      .find((button) =>
        button.textContent?.includes(`${labels.byId.get('sub-3.2.2')?.label} · calls`),
      );
    expect(finding).toBeDefined();
    if (!finding) throw new Error('fixture needs a child finding');
    await user.click(finding);
    await waitFor(() =>
      expect(drawFrame).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          view: expect.objectContaining({ span: expect.any(Number) }),
        }),
        expect.objectContaining({
          focusedFinding: expect.objectContaining({ agentId: expect.any(String) }),
        }),
        expect.anything(),
      ),
    );
    expect(screen.getByRole('status', { name: 'Focused finding' })).not.toHaveTextContent(
      'sub-3.2.2:',
    );
    const call = vi.mocked(drawFrame).mock.calls.at(-1);
    expect(call?.[2].view.span).toBeLessThan(nested.callCount);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: `Collapse ${label}` })).toBeInTheDocument();
  });

  it('anchors the tooltip, freezes hover inside it, and opens the original agent', async () => {
    const { onOpenNode } = mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    const move = (x: number, y: number) =>
      fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    move(170, 40);
    const tooltip = await screen.findByRole('tooltip');
    const anchor = tooltip.getAttribute('style');
    move(171, 41);
    await waitFor(() => expect(drawFrame).toHaveBeenCalled());
    expect(tooltip.getAttribute('style')).toBe(anchor);
    fireEvent.pointerOver(tooltip);
    await act(async () => {
      move(800, 40);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(tooltip).toHaveTextContent('Calls #1–#1');
    expect(tooltip.getAttribute('style')).toBe(anchor);
    fireEvent.click(within(tooltip).getByRole('button', { name: 'Open' }));
    expect(onOpenNode).toHaveBeenCalledWith(short.agents[0]?.id);
  });

  it('highlights an agent when its label is clicked', async () => {
    mount();
    const canvas = await screen.findByLabelText(/Agent lanes:.*calls/);
    await waitFor(() => expect(drawFrame).toHaveBeenCalled());
    fireEvent.click(canvas, { clientX: 80, clientY: 40 });
    await waitFor(() =>
      expect(vi.mocked(drawFrame).mock.calls.at(-1)?.[3].selectedAgentId).toBe(short.agents[0]?.id),
    );
  });

  it('enters fullscreen, uses fixed fallback when rejected, and exits on Escape', async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: request,
    });
    mount();
    await screen.findByLabelText(/Agent lanes:/);
    await user.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: 'Agent lanes' })).toHaveStyle({
      position: 'fixed',
      inset: '0',
    });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument();
  });

  it('shows loading and a retryable error without reporting stale node counts', async () => {
    let finish: ((response: Response) => void) | undefined;
    server.use(
      http.get(
        '/api/sessions/:id/profile/lanes',
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const { onNodeCount } = mount();
    expect(screen.getByRole('status', { name: 'Loading agent lanes' })).toBeInTheDocument();
    await waitFor(() => expect(finish).toBeDefined());
    finish?.(HttpResponse.json({ error: 'failed' }, { status: 500 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load agent lanes');
    expect(onNodeCount).toHaveBeenCalledWith(null);
    server.use(http.get('/api/sessions/:id/profile/lanes', () => HttpResponse.json(short)));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText(/Agent lanes:/);
  });

  it('restores the node count after a refresh returns structurally identical data', async () => {
    const { onNodeCount, queryClient } = mount();
    await screen.findByLabelText(/Agent lanes:/);
    await waitFor(() => expect(onNodeCount).toHaveBeenLastCalledWith(0));
    onNodeCount.mockClear();
    let finish: ((response: Response) => void) | undefined;
    server.use(
      http.get(
        '/api/sessions/:id/profile/lanes',
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const refresh = queryClient.invalidateQueries({
      queryKey: ['session-profile', 'sess-1', 'lanes'],
    });
    await waitFor(() => expect(onNodeCount).toHaveBeenLastCalledWith(null));
    finish?.(HttpResponse.json({ ...short, sessionId: 'sess-1' }));
    await refresh;
    await waitFor(() => expect(onNodeCount).toHaveBeenLastCalledWith(0));
  });

  it('strictly validates the columnar response and strips unknown content', async () => {
    const response = structuredClone(short) as LanesResponse;
    server.use(
      http.get('/api/sessions/:id/profile/lanes', () =>
        HttpResponse.json({ ...response, prompt: 'never copy' }),
      ),
    );
    const data = await fetchSessionProfileLanes('test', { scope: 'tree' });
    expect(data.view).toBe('lanes');
    expect(data).not.toHaveProperty('prompt');
    response.agents[0]?.calls.tools.pop();
    await expect(fetchSessionProfileLanes('test')).rejects.toThrow(
      'invalid session profile lanes response',
    );
  });
});
