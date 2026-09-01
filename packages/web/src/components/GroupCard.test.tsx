import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { SessionRollup, SessionSummary } from '../api/types';
import {
  aggregateTokens,
  compareOptional,
  GroupCard,
  type GroupCardProps,
  sortByLatestActivityDesc,
  sparklineSeriesFromSessions,
} from './GroupCard';
import { LetterAvatar } from './primitives/LetterAvatar';
import { makeRollup, makeSummary, metric } from './session-detail/fixtures';

afterEach(() => {
  cleanup();
});

const NOW = Date.parse('2026-08-31T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('aggregateTokens', () => {
  test('sums both halves and keeps the weakest reported confidence', () => {
    expect(
      aggregateTokens({
        totalInput: { value: 1_000, confidence: 'high', source: 'a' },
        output: { value: 500, confidence: 'medium', source: 'b' },
      }),
    ).toMatchObject({ total: 1_500, confidence: 'medium' });
  });

  test('a missing half is counted as 0 and caps the sum at low confidence', () => {
    const result = aggregateTokens({
      totalInput: { value: 1_000, confidence: 'high', source: 'a' },
    });
    expect(result.total).toBe(1_000);
    expect(result.confidence).toBe('low');
    expect(result.title).toContain('Output — not reported');
  });

  test('neither half reported means there is no total at all', () => {
    expect(aggregateTokens({}).total).toBeUndefined();
  });
});

describe('compareOptional', () => {
  test('absent values sort last, in both directions', () => {
    expect(compareOptional(undefined, 'a')).toBeGreaterThan(0);
    expect(compareOptional('a', undefined)).toBeLessThan(0);
    expect(compareOptional(undefined, undefined)).toBe(0);
  });
});

describe('sortByLatestActivityDesc', () => {
  test('newest first, absent activity sorts last regardless of position', () => {
    const older = { name: 'older', latestActivityAt: new Date(NOW - 2 * HOUR).toISOString() };
    const newer = { name: 'newer', latestActivityAt: new Date(NOW - HOUR).toISOString() };
    const never = { name: 'never', latestActivityAt: undefined };

    expect(sortByLatestActivityDesc([older, never, newer]).map((x) => x.name)).toEqual([
      'newer',
      'older',
      'never',
    ]);
    expect(sortByLatestActivityDesc([never, newer, older]).map((x) => x.name)).toEqual([
      'newer',
      'older',
      'never',
    ]);
  });
});

describe('sparklineSeriesFromSessions', () => {
  test('one point per session, oldest first, valued by inclusive aggregate tokens', () => {
    const older: SessionSummary = makeSummary({
      id: 'fake:older',
      timing: { startedAt: metric(new Date(NOW - 2 * HOUR).toISOString()) },
    });
    const newer: SessionSummary = makeSummary({
      id: 'fake:newer',
      timing: { startedAt: metric(new Date(NOW - HOUR).toISOString()) },
    });
    const rollups: Record<string, SessionRollup> = {
      'fake:older': makeRollup({
        id: 'fake:older',
        inclusive: {
          usage: { totalInput: metric(100), output: metric(50) },
          counts: { subagents: metric(0) },
        },
      }),
      'fake:newer': makeRollup({
        id: 'fake:newer',
        inclusive: {
          usage: { totalInput: metric(400), output: metric(100) },
          counts: { subagents: metric(0) },
        },
      }),
    };

    // Passed in reverse-chronological order on purpose: the series must sort
    // by time itself, not trust caller order.
    expect(sparklineSeriesFromSessions([newer, older], rollups)).toEqual([150, 500]);
  });

  test('a session with no rollup contributes 0, not a crash or a dropped point', () => {
    const summary = makeSummary({ id: 'fake:orphan' });
    expect(sparklineSeriesFromSessions([summary], {})).toEqual([0]);
  });

  test('an empty session list is an empty series', () => {
    expect(sparklineSeriesFromSessions([], {})).toEqual([]);
  });
});

const BASE_PROPS: Omit<GroupCardProps, 'direction' | 'onOpen'> = {
  name: 'acme-app',
  avatar: <LetterAvatar label="acme-app" size="lg" />,
  sessionCount: 12,
  crossDimension: ['Claude Code', 'Codex'],
  latestActivityAt: new Date(NOW - 2 * HOUR).toISOString(),
  aggregateUsage: {
    totalInput: { value: 12_000, confidence: 'high', source: 'claude-code/usage' },
    output: { value: 3_000, confidence: 'high', source: 'claude-code/usage' },
  },
  sparklineSeries: [100, 200, 150, 400],
  now: NOW,
};

/**
 * Base UI assigns each tooltip trigger a sequential `id="base-ui-_r_N_"` from
 * a module-level counter that does not reset between renders, so two
 * otherwise-identical trees never come out byte-identical on that attribute
 * alone. Strip it before comparing -- it is generated wiring, not part of
 * either direction's markup.
 */
function stripGeneratedIds(html: string): string {
  return html.replace(/id="base-ui-[^"]*"/g, 'id="base-ui-_"');
}

describe('GroupCard', () => {
  test('serves both directions from the same component: only the cross-dimension label text differs', () => {
    const projectView = render(
      <GroupCard {...BASE_PROPS} direction="project" onOpen={() => undefined} />,
    );
    const projectHtml = stripGeneratedIds(projectView.container.innerHTML);
    cleanup();

    const harnessView = render(
      <GroupCard {...BASE_PROPS} direction="harness" onOpen={() => undefined} />,
    );
    const harnessHtml = stripGeneratedIds(harnessView.container.innerHTML);

    expect(projectHtml).not.toBe(harnessHtml);
    // Swapping the one word that names the cross-dimension makes the two
    // renders byte-identical -- proof the DOM structure and every class list
    // are unchanged between directions, not just "looks similar".
    expect(projectHtml.replace('Harnesses', 'Projects')).toBe(harnessHtml);
  });

  test('project card: renders name, session count, cross-dimension badges, activity and tokens', () => {
    render(<GroupCard {...BASE_PROPS} direction="project" onOpen={() => undefined} />);
    expect(screen.getByText('acme-app')).not.toBeNull();
    expect(screen.getByText('12 sessions')).not.toBeNull();
    expect(screen.getByText('Harnesses')).not.toBeNull();
    expect(screen.getByText('Claude Code')).not.toBeNull();
    expect(screen.getByText('Codex')).not.toBeNull();
    expect(screen.getByText('2 hours ago')).not.toBeNull();
    // Both usage halves are high confidence: 15.0k, no marker.
    expect(screen.getByText('15.0k')).not.toBeNull();
  });

  test('harness card: cross-dimension label reads "Projects"', () => {
    render(<GroupCard {...BASE_PROPS} direction="harness" onOpen={() => undefined} />);
    expect(screen.getByText('Projects')).not.toBeNull();
  });

  test('a session count of exactly 1 is singular', () => {
    render(
      <GroupCard {...BASE_PROPS} direction="project" sessionCount={1} onOpen={() => undefined} />,
    );
    expect(screen.getByText('1 session')).not.toBeNull();
  });

  test('an empty cross-dimension list renders "None yet", not a blank row', () => {
    render(
      <GroupCard
        {...BASE_PROPS}
        direction="harness"
        crossDimension={[]}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('None yet')).not.toBeNull();
  });

  test('a large cross-dimension list (real-world scale) caps visible badges and shows an overflow indicator', () => {
    // Matches the real defect: one harness (Claude Code) touching 204 real
    // projects blew the card out to the whole page. Use a comparable scale
    // (150) rather than the exact number, so the assertion is about the
    // capping behavior, not a magic constant tied to one snapshot of data.
    const manyProjects = Array.from({ length: 150 }, (_, i) => `project-${i}`);
    render(
      <GroupCard
        {...BASE_PROPS}
        direction="harness"
        crossDimension={manyProjects}
        onOpen={() => undefined}
      />,
    );

    // Exactly the capped number of item badges render, not all 150.
    const visibleBadges = manyProjects.slice(0, 4);
    for (const label of visibleBadges) {
      expect(screen.getByText(label)).not.toBeNull();
    }
    for (const label of manyProjects.slice(4)) {
      expect(screen.queryByText(label)).toBeNull();
    }

    // The overflow indicator shows the correct remaining count...
    const overflow = screen.getByText('+146 more');
    expect(overflow).not.toBeNull();

    // ...and the full list is still reachable through it, not silently
    // dropped: the wrapping element's title carries every label.
    const overflowWrapper = overflow.closest('[title]');
    expect(overflowWrapper).not.toBeNull();
    const title = overflowWrapper?.getAttribute('title') ?? '';
    for (const label of manyProjects) {
      expect(title).toContain(label);
    }
  });

  test('a cross-dimension list at or under the cap shows every item with no overflow indicator', () => {
    render(
      <GroupCard
        {...BASE_PROPS}
        direction="project"
        crossDimension={['a', 'b', 'c', 'd']}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('a')).not.toBeNull();
    expect(screen.getByText('b')).not.toBeNull();
    expect(screen.getByText('c')).not.toBeNull();
    expect(screen.getByText('d')).not.toBeNull();
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  test('clicking the card calls onOpen', () => {
    let opened = 0;
    render(<GroupCard {...BASE_PROPS} direction="project" onOpen={() => opened++} />);
    fireEvent.click(screen.getByRole('button', { name: /acme-app/ }));
    expect(opened).toBe(1);
  });

  describe('the installed-no-sessions empty variant', () => {
    test('renders distinct empty markup, not the normal card body and not an error', () => {
      render(
        <GroupCard
          {...BASE_PROPS}
          direction="harness"
          sessionCount={0}
          aggregateUsage={{}}
          sparklineSeries={[]}
          emptyVariant="installed-no-sessions"
          onOpen={() => undefined}
        />,
      );
      expect(screen.getByText('Installed · no sessions')).not.toBeNull();
      // None of the normal-state sections render: no cross-dimension caption,
      // no aggregate-token cell, no sparkline (empty or otherwise).
      expect(screen.queryByText('Projects')).toBeNull();
      expect(screen.queryByText('Claude Code')).toBeNull();
      expect(screen.queryByText('15.0k')).toBeNull();
      expect(screen.queryByRole('img', { name: /recent activity/ })).toBeNull();
      expect(screen.queryByText('No activity')).toBeNull();
      // Still a real, non-crashing card: the name and a click target remain.
      expect(screen.getByRole('button', { name: /acme-app/ })).not.toBeNull();
    });

    test('is a genuinely different render than an incidental empty state (0 sessions, no emptyVariant)', () => {
      const emptyVariantView = render(
        <GroupCard
          {...BASE_PROPS}
          direction="harness"
          sessionCount={0}
          crossDimension={[]}
          aggregateUsage={{}}
          sparklineSeries={[]}
          emptyVariant="installed-no-sessions"
          onOpen={() => undefined}
        />,
      );
      const emptyVariantHtml = emptyVariantView.container.innerHTML;
      cleanup();

      const incidentalView = render(
        <GroupCard
          {...BASE_PROPS}
          direction="harness"
          sessionCount={0}
          crossDimension={[]}
          aggregateUsage={{}}
          sparklineSeries={[]}
          onOpen={() => undefined}
        />,
      );
      expect(emptyVariantHtml).not.toBe(incidentalView.container.innerHTML);
      expect(screen.getByText('0 sessions')).not.toBeNull();
      expect(screen.getByText('None yet')).not.toBeNull();
      expect(screen.getByText('No activity')).not.toBeNull();
    });
  });

  test('a sparkline series with fewer than 2 points renders the Sparkline empty state, not a degenerate shape', () => {
    render(
      <GroupCard
        {...BASE_PROPS}
        direction="project"
        sparklineSeries={[7]}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByText('No activity')).not.toBeNull();
  });
});
