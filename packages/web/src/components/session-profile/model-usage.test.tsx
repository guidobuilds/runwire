import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import { mockProfileModelsTree, PROFILE_ROOT_ID } from '@/mocks/session-profile';
import { formatShare, ModelUsage } from './model-usage';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function renderModelUsage(props: Partial<React.ComponentProps<typeof ModelUsage>> = {}) {
  return render(<ModelUsage sessionId={PROFILE_ROOT_ID} {...props} />, { wrapper });
}

function labelTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.recharts-pie-label-text')).map(
    (node) => node.textContent ?? '',
  );
}

describe('ModelUsage — chart labels', () => {
  it('renders each slice label with the model name and percentage', async () => {
    const { container } = renderModelUsage();

    expect(await screen.findByText('Models in this session')).toBeInTheDocument();
    expect(screen.getByText('Models in subagent sessions')).toBeInTheDocument();

    await waitFor(() => {
      expect(labelTexts(container)).toHaveLength(3);
    });

    expect(labelTexts(container)).toEqual(
      expect.arrayContaining([
        `claude-sonnet-5 — ${formatShare(0.9)}`,
        `claude-opus-4 — ${formatShare(0.75)}`,
        `claude-haiku-4 — ${formatShare(0.25)}`,
      ]),
    );
  });

  it('formats shares as integer percentages', () => {
    expect(formatShare(0.9)).toMatch(/90\s*%/);
    expect(formatShare(0)).toMatch(/0\s*%/);
  });
});

describe('ModelUsage — donut slices', () => {
  it('excludes share-0 entries from both slices and labels', async () => {
    const { container } = renderModelUsage();

    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3);
    });
    expect(labelTexts(container)).not.toContain(`claude-haiku-4 — ${formatShare(0)}`);
  });
});

describe('ModelUsage — empty states', () => {
  it('renders both empty messages when each group has no entries', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/models', () =>
        HttpResponse.json({
          view: 'models',
          sessionId: PROFILE_ROOT_ID,
          session: { outputTokens: 0, models: [] },
          descendants: { outputTokens: 0, models: [] },
        }),
      ),
    );

    renderModelUsage();

    expect(await screen.findByText('No model information recorded')).toBeInTheDocument();
    expect(screen.getByText('No subagent sessions')).toBeInTheDocument();
  });

  it('shows only the empty group message when the other group has entries', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/models', () =>
        HttpResponse.json({
          view: 'models',
          sessionId: PROFILE_ROOT_ID,
          session: { outputTokens: 0, models: [] },
          descendants: mockProfileModelsTree.descendants,
        }),
      ),
    );

    renderModelUsage();

    expect(await screen.findByText('No model information recorded')).toBeInTheDocument();
    expect(screen.queryByText('No subagent sessions')).not.toBeInTheDocument();
  });

  it('omits a 0-token "other" entry from both slices and labels', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/models', () =>
        HttpResponse.json({
          view: 'models',
          sessionId: PROFILE_ROOT_ID,
          session: {
            outputTokens: 500,
            models: [
              { model: 'claude-sonnet-5', outputTokens: 500, share: 1 },
              { model: 'other', outputTokens: 0, share: 0 },
            ],
          },
          descendants: { outputTokens: 0, models: [] },
        }),
      ),
    );

    const { container } = renderModelUsage();

    await waitFor(() => {
      expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(1);
    });
    expect(labelTexts(container)).toEqual([`claude-sonnet-5 — ${formatShare(1)}`]);
    expect(labelTexts(container)).not.toContain(`Other models — ${formatShare(0)}`);
  });
});

describe('ModelUsage — error state', () => {
  it('renders a muted "Model usage unavailable" on failure', async () => {
    server.use(
      http.get('/api/sessions/:id/profile/models', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );

    renderModelUsage();

    expect(await screen.findByText('Model usage unavailable')).toBeInTheDocument();
  });
});

describe('ModelUsage — refresh key', () => {
  it('refetches when refresh changes', async () => {
    let calls = 0;
    server.use(
      http.get('/api/sessions/:id/profile/models', () => {
        calls += 1;
        return HttpResponse.json(mockProfileModelsTree);
      }),
    );

    const { rerender } = renderModelUsage({ refresh: 0 });
    await waitFor(() => expect(calls).toBe(1));

    rerender(<ModelUsage refresh={1} sessionId={PROFILE_ROOT_ID} />);
    await waitFor(() => expect(calls).toBe(2));
  });
});

describe('ModelUsage — pending state', () => {
  it('renders a skeleton while the query is pending', async () => {
    let release: (() => void) | undefined;
    server.use(
      http.get(
        '/api/sessions/:id/profile/models',
        () =>
          new Promise((resolve) => {
            release = () => resolve(HttpResponse.json(mockProfileModelsTree));
          }),
      ),
    );

    const { container } = renderModelUsage();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByText('Models in this session')).not.toBeInTheDocument();

    await waitFor(() => expect(release).toBeDefined());
    release?.();
    expect(await screen.findByText('Models in this session')).toBeInTheDocument();
  });
});
