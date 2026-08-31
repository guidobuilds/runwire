import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

/**
 * Permanent runner canary. It proves, in one shot, that the Vitest runner, the
 * react-jsx transform, the happy-dom environment and the tsconfig `types`
 * override (browser globals available, Bun globals absent) all line up. If this
 * fails, the failure is in the toolchain, not in a feature.
 */
function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe('web toolchain', () => {
  test('renders a component into a DOM document', () => {
    render(<Greeting name="scout" />);
    expect(screen.getByText('Hello, scout')).not.toBeNull();
  });

  test('runs in a browser-like environment, not under bun:test', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
    expect(globalThis.navigator.userAgent).toContain('HappyDOM');
  });
});
