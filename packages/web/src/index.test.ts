import { expect, test } from 'bun:test';
import { webPlaceholder } from './index';

test('web can import a type from the core workspace', () => {
  expect(webPlaceholder.scout).toBe(true);
});
