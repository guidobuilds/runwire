import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { PageHeading } from './PageHeading';

afterEach(() => {
  cleanup();
});

describe('PageHeading', () => {
  test('renders eyebrow, title (as an h1) and description', () => {
    render(<PageHeading eyebrow="Scout" title="Sessions" description="Every session." />);

    expect(screen.getByText('Scout')).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Sessions');
    expect(screen.getByText('Every session.')).toBeTruthy();
  });

  test('omits eyebrow/description when not given, and renders the right slot', () => {
    render(<PageHeading title="Projects" right={<button type="button">Action</button>} />);

    expect(screen.queryByText('Scout')).toBeNull();
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy();
  });

  test('titleAttr sets the literal HTML title attribute on the h1, independent of the rendered title', () => {
    render(<PageHeading title="Rebuild the ro…" titleAttr="Rebuild the rollup end to end" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Rebuild the ro…');
    expect(heading.getAttribute('title')).toBe('Rebuild the rollup end to end');
  });

  test('description accepts rich content, not just plain text', () => {
    render(
      <PageHeading title="Sessions" description={<span className="font-mono">fake:abc</span>} />,
    );
    expect(screen.getByText('fake:abc').tagName).toBe('SPAN');
  });
});
