import type { ApiSessionDetail, ApiSessionSummary, ApiTokenTotals } from '@scout/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/node';
import { PROFILE_ROOT_ID } from '@/mocks/session-profile';
import { SignalsAccordion } from './signals-accordion';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

function tokens(output: number): ApiTokenTotals {
  return { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output, reasoningOutput: 0 };
}

const baseSummary: ApiSessionSummary = {
  id: PROFILE_ROOT_ID,
  name: 'Root',
  title: null,
  parentId: null,
  harness: { id: 'claude-code', displayName: 'Claude Code', adapterVersion: '1.0.0' },
  project: null,
  depth: 0,
  relation: null,
  agentType: null,
  startedAt: null,
  endedAt: null,
  durationMs: null,
  modelPrimary: null,
  modelsOwn: [],
  modelsDescendants: [],
  tokensOwn: tokens(300),
  tokensInclusive: tokens(1000),
  turnsOwn: 0,
  apiCallsOwn: 0,
  apiCallsInclusive: 0,
  toolCallsOwn: 0,
  toolCallsInclusive: 0,
  compactionsOwn: 0,
  compactionsInclusive: 0,
  costUsd: null,
  childCount: 0,
  descendantCount: 0,
};

function session(overrides: Partial<ApiSessionDetail> = {}): ApiSessionDetail {
  return { ...baseSummary, parent: null, children: [], ...overrides };
}

function renderAccordion(props: Partial<React.ComponentProps<typeof SignalsAccordion>> = {}) {
  return render(
    <SignalsAccordion
      field="output"
      session={session()}
      sessionId={PROFILE_ROOT_ID}
      subagentCount={2}
      {...props}
    />,
    { wrapper },
  );
}

describe('SignalsAccordion — collapsed by default', () => {
  it('does not render signal values until expanded, then shows them', async () => {
    renderAccordion();

    const trigger = await screen.findByRole('button', { name: 'Harness signals' });
    expect(screen.queryByText('Model changes')).not.toBeInTheDocument();

    await userEvent.click(trigger);

    expect(await screen.findByText('Model changes')).toBeInTheDocument();
  });
});

describe('SignalsAccordion — values from fixture', () => {
  it('renders compactions, model changes, mcp/skill counts+lists', async () => {
    renderAccordion();
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    await screen.findByText('Model changes');
    expect(screen.getByText('2 / 6 (33%)')).toBeInTheDocument();
    expect(screen.getByText('plugin_engram_engram')).toBeInTheDocument();
    expect(screen.getByText('skill-doctor')).toBeInTheDocument();
    expect(screen.getByText(/Expensive-model-on-cheap-work is not assessed/)).toBeInTheDocument();
  });
});

describe('SignalsAccordion — delegation math', () => {
  it('computes 1 - own/inclusive when inclusive > 0', async () => {
    renderAccordion({
      session: session({ tokensOwn: tokens(300), tokensInclusive: tokens(1000) }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    expect(await screen.findByText('70%')).toBeInTheDocument();
  });

  it('renders "not comparable" when inclusive is 0', async () => {
    renderAccordion({ session: session({ tokensOwn: tokens(0), tokensInclusive: tokens(0) }) });
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    expect(await screen.findByText('not comparable')).toBeInTheDocument();
  });

  it('renders — for a null subagent count', async () => {
    renderAccordion({ subagentCount: null });
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    await screen.findByText('Subagents');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('SignalsAccordion — every value renders even when 0', () => {
  it('shows zero compactions/calls and "none" lists, not hidden fields', async () => {
    server.use(
      http.get('/session-profiles/:id', () =>
        HttpResponse.json({
          view: 'signals',
          sessionId: PROFILE_ROOT_ID,
          scope: 'tree',
          compactions: { auto: 0, manual: 0, unknown: 0 },
          modelChanges: 0,
          toolCalls: { total: 0, mcp: 0 },
          mcpServers: [],
          skillCalls: 0,
          skillNames: [],
        }),
      ),
    );

    renderAccordion();
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    await screen.findByText('Model changes');
    expect(screen.getByText('0 / 0 (0%)')).toBeInTheDocument();
    expect(screen.getAllByText('none')).toHaveLength(2);
  });
});

describe('SignalsAccordion — error + retry', () => {
  it('shows an inline error and Retry scoped to the item', async () => {
    server.use(
      http.get('/session-profiles/:id', () =>
        HttpResponse.json({ error: 'internal error' }, { status: 500 }),
      ),
    );

    renderAccordion();
    await userEvent.click(screen.getByRole('button', { name: 'Harness signals' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });
});
