import type { LanesResponse } from '@runwire/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('expands and focuses a finding, zooms, and exposes agent collapse and Open actions', async () => {
    const user = userEvent.setup();
    const { onOpenNode, onNodeCount } = mount('nested');
    await screen.findByLabelText(/Agent lanes:/);
    expect(onNodeCount).toHaveBeenCalledWith(nested.agents.length - 1);
    await user.click(screen.getByRole('button', { name: /Indicators/ }));
    const agents = screen.getByRole('list', { name: 'Agents' });
    await user.click(within(agents).getByRole('button', { name: 'Collapse sub-3' }));
    expect(within(agents).getByRole('button', { name: 'Expand sub-3' })).toHaveTextContent(
      '+5 hidden',
    );
    await user.click(within(agents).getByRole('button', { name: 'Open main' }));
    expect(onOpenNode).toHaveBeenCalledWith('main');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Detections/ }));
    const findings = screen.getByRole('list', { name: 'Findings' });
    const finding = within(findings)
      .getAllByRole('button')
      .find((button) => /sub-3\.2\.2:/.test(button.textContent ?? ''));
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
    expect(screen.getByRole('status', { name: 'Focused finding' })).toHaveTextContent(
      finding.textContent ?? '',
    );
    const call = vi.mocked(drawFrame).mock.calls.at(-1);
    expect(call?.[2].view.span).toBeLessThan(nested.callCount);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Indicators/ }));
    expect(screen.getByRole('button', { name: 'Collapse sub-3' })).toBeInTheDocument();
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
