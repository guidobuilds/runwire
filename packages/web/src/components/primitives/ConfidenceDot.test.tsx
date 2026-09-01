import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ConfidenceDot } from './ConfidenceDot';

describe('ConfidenceDot', () => {
  afterEach(() => {
    cleanup();
  });

  test('standalone (default): each level is an accessible role=img with a matching name', () => {
    const view = render(<ConfidenceDot level="high" />);
    expect(screen.getByRole('img', { name: 'high confidence' })).not.toBeNull();
    view.unmount();

    render(<ConfidenceDot level="medium" />);
    expect(screen.getByRole('img', { name: 'medium confidence' })).not.toBeNull();
    cleanup();

    render(<ConfidenceDot level="low" />);
    expect(screen.getByRole('img', { name: 'low confidence' })).not.toBeNull();
  });

  test('standalone dot is not aria-hidden', () => {
    render(<ConfidenceDot level="medium" />);
    expect(
      screen.getByRole('img', { name: 'medium confidence' }).getAttribute('aria-hidden'),
    ).toBeNull();
  });

  test('each level resolves its own --confidence-* token, never a literal hex', () => {
    const high = render(<ConfidenceDot level="high" />);
    expect(high.container.firstChild).toHaveProperty(
      'className',
      expect.stringContaining('bg-[var(--confidence-high)]'),
    );
    high.unmount();

    const medium = render(<ConfidenceDot level="medium" />);
    expect(medium.container.firstChild).toHaveProperty(
      'className',
      expect.stringContaining('bg-[var(--confidence-medium)]'),
    );
    medium.unmount();

    const low = render(<ConfidenceDot level="low" />);
    expect(low.container.firstChild).toHaveProperty(
      'className',
      expect.stringContaining('bg-[var(--confidence-low)]'),
    );
  });

  test('decorative=true: no role and hidden from assistive technology', () => {
    render(<ConfidenceDot level="medium" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    const dot = document.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });
});
