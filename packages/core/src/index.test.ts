import { expect, test } from 'bun:test';
import { VERSION } from './index';

test('core exports a version placeholder', () => {
  expect(VERSION).toBe('0.0.0');
});
