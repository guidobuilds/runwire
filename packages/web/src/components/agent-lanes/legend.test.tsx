import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Legend } from './legend';
import { laneRoleSwatches } from './renderer/theme';

it('lists all seven kinds and three tiers using renderer tokens and live bucket size', () => {
  const { rerender } = render(<Legend bucketSize={8} />);
  const legend = screen.getByRole('region', { name: 'Agent lanes legend' });
  const { kinds, tiers } = laneRoleSwatches();
  expect(kinds).toHaveLength(7);
  expect(tiers).toHaveLength(3);
  for (const entry of [...kinds, ...tiers]) {
    const label = screen.getByText(entry.label);
    expect(legend).toContainElement(label);
    expect(label.querySelector('[aria-hidden]')).toHaveStyle({
      backgroundColor: `var(${entry.token})`,
    });
  }
  expect(screen.getByText('1 column = 8 calls', { exact: true })).toBeInTheDocument();
  rerender(<Legend bucketSize={1} />);
  expect(screen.getByText('1 column = 1 call', { exact: true })).toBeInTheDocument();
});
