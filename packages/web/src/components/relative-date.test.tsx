import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime, formatRelative, RelativeDate } from './relative-date';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const NOW = Date.parse('2026-09-01T12:00:00.000Z');

/** A `value` that is unambiguously `daysAgo` old, with a one-minute buffer so
 * real-clock drift between building the value and rendering can never cross a
 * whole-unit boundary. */
function pastIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY - MINUTE).toISOString();
}

describe('formatRelative — units, boundaries and empty states', () => {
  it('renders an em dash for null and invalid values', () => {
    expect(formatRelative(null, NOW)).toBe('—');
    expect(formatRelative('not-a-date', NOW)).toBe('—');
  });

  it('renders "just now" under a minute in either direction', () => {
    expect(formatRelative('2026-09-01T11:59:30.000Z', NOW)).toBe('just now');
    expect(formatRelative('2026-09-01T12:00:30.000Z', NOW)).toBe('just now');
  });

  it('steps minutes at the exact 60s boundary and stays a minute under the hour', () => {
    expect(formatRelative('2026-09-01T11:59:00.000Z', NOW)).toBe('1m ago');
    expect(formatRelative('2026-09-01T11:00:01.000Z', NOW)).toBe('59m ago');
  });

  it('steps hours at the exact 60m boundary and days at the exact 24h boundary', () => {
    expect(formatRelative('2026-09-01T11:00:00.000Z', NOW)).toBe('1h ago');
    expect(formatRelative('2026-08-31T13:00:00.000Z', NOW)).toBe('23h ago');
    expect(formatRelative('2026-08-31T12:00:00.000Z', NOW)).toBe('1d ago');
  });

  it('steps months at 30d and years at 365d', () => {
    expect(formatRelative('2026-08-03T12:00:00.000Z', NOW)).toBe('29d ago');
    expect(formatRelative('2026-08-02T12:00:00.000Z', NOW)).toBe('1mo ago');
    expect(formatRelative('2026-03-02T12:00:00.000Z', NOW)).toBe('6mo ago');
    // The 30d month approximation fills 360–364 days with "12mo" before the
    // 365d year bucket takes over.
    expect(formatRelative('2025-09-06T12:00:00.000Z', NOW)).toBe('12mo ago');
    expect(formatRelative('2025-09-01T12:00:00.000Z', NOW)).toBe('1y ago');
  });

  it('describes future timestamps as "in …" instead of a negative age', () => {
    expect(formatRelative('2026-09-01T12:05:00.000Z', NOW)).toBe('in 5m');
    expect(formatRelative('2026-09-01T13:00:00.000Z', NOW)).toBe('in 1h');
    expect(formatRelative('2026-09-03T12:00:00.000Z', NOW)).toBe('in 2d');
    expect(formatRelative('2026-08-31T12:00:00.000Z', NOW)).toBe('1d ago');
  });
});

describe('RelativeDate — display and interaction', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the relative form by default, never the absolute form', () => {
    const value = pastIso(2);
    render(<RelativeDate value={value} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('2d ago');
    expect(button).not.toHaveTextContent(formatDateTime(value));
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('temporarily reveals the absolute date on hover and restores relative on unhover', () => {
    const value = pastIso(2);
    render(<RelativeDate value={value} />);
    const button = screen.getByRole('button');

    fireEvent.mouseEnter(button);
    expect(button).toHaveTextContent(formatDateTime(value));

    fireEvent.mouseLeave(button);
    expect(button).toHaveTextContent('2d ago');
  });

  it('pins the absolute date on click until clicked again, independent of hover', () => {
    const value = pastIso(2);
    render(<RelativeDate value={value} />);
    const button = screen.getByRole('button');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent(formatDateTime(value));

    // Leaving the cell must not clear a pinned date.
    fireEvent.mouseLeave(button);
    expect(button).toHaveTextContent(formatDateTime(value));

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('2d ago');
  });

  it('is a native button: Enter and Space toggle it from the keyboard', async () => {
    const value = pastIso(2);
    const user = userEvent.setup();
    render(<RelativeDate value={value} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');

    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent(formatDateTime(value));

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('2d ago');
  });

  it('keeps each date cell independent', () => {
    const older = pastIso(3);
    const newer = pastIso(1);
    render(
      <>
        <RelativeDate value={older} />
        <RelativeDate value={newer} />
      </>,
    );

    const [first, second] = screen.getAllByRole('button');
    fireEvent.click(first as HTMLElement);

    expect(first).toHaveTextContent(formatDateTime(older));
    expect(second).toHaveTextContent('1d ago');
  });

  it('does not bubble the click past the table row (no row navigation)', () => {
    const documentClick = vi.fn();
    document.addEventListener('click', documentClick);
    try {
      render(<RelativeDate value={pastIso(2)} />);
      fireEvent.click(screen.getByRole('button'));
      expect(documentClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', documentClick);
    }
  });

  it('renders a plain em dash, with no control, for null and invalid values', () => {
    const { unmount } = render(<RelativeDate value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    render(<RelativeDate value="not-a-date" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('refreshes relative text from one shared clock as time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));

    render(<RelativeDate value="2026-09-01T11:59:30.000Z" />);
    expect(screen.getByRole('button')).toHaveTextContent('just now');

    act(() => {
      vi.advanceTimersByTime(MINUTE);
    });

    expect(screen.getByRole('button')).toHaveTextContent('1m ago');
  });
});

describe('RelativeDate — controlled column mode (dashboard)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders exactly the controlled format and never changes it on hover', () => {
    const value = pastIso(2);
    const { rerender } = render(
      <RelativeDate value={value} showAbsolute={false} onToggle={() => {}} />,
    );

    const relativeButton = screen.getByRole('button');
    expect(relativeButton).toHaveTextContent('2d ago');
    expect(relativeButton).toHaveAttribute('aria-pressed', 'false');

    // A dashboard cell must not react to the pointer at all.
    fireEvent.mouseEnter(relativeButton);
    expect(relativeButton).toHaveTextContent('2d ago');

    rerender(<RelativeDate value={value} showAbsolute onToggle={() => {}} />);
    const absoluteButton = screen.getByRole('button');
    expect(absoluteButton).toHaveTextContent(formatDateTime(value));
    expect(absoluteButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.mouseEnter(absoluteButton);
    fireEvent.mouseLeave(absoluteButton);
    expect(absoluteButton).toHaveTextContent(formatDateTime(value));
  });

  it('reports activation through onToggle instead of pinning itself', () => {
    const value = pastIso(2);
    const onToggle = vi.fn();
    render(<RelativeDate value={value} showAbsolute={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    // The owner owns the column format; this cell does not switch on its own.
    expect(screen.getByRole('button')).toHaveTextContent('2d ago');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('treats Enter and Space as activation in controlled mode', async () => {
    const value = pastIso(2);
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<RelativeDate value={value} showAbsolute={false} onToggle={onToggle} />);

    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('still renders a plain em dash, with no control, for null in controlled mode', () => {
    render(<RelativeDate value={null} showAbsolute onToggle={() => {}} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
