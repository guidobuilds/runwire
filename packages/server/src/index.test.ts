import { expect, test } from 'bun:test';
import { greeting } from './index';

test('server can resolve the core workspace dependency', () => {
  expect(greeting()).toBe('scout server — core v0.0.0');
});
