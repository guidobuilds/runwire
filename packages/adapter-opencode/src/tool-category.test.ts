import { describe, expect, test } from 'bun:test';
import { opencodeToolCategory } from './tool-category';

describe('opencodeToolCategory', () => {
  test('maps OpenCode lowercase tool names', () => {
    expect(opencodeToolCategory('read')).toBe('read');
    expect(opencodeToolCategory('glob')).toBe('search');
    expect(opencodeToolCategory('grep')).toBe('search');
    expect(opencodeToolCategory('edit')).toBe('write');
    expect(opencodeToolCategory('write')).toBe('write');
    expect(opencodeToolCategory('patch')).toBe('write');
    expect(opencodeToolCategory('shell')).toBe('exec');
    expect(opencodeToolCategory('execute')).toBe('exec');
    expect(opencodeToolCategory('webfetch')).toBe('web');
    expect(opencodeToolCategory('websearch')).toBe('web');
    expect(opencodeToolCategory('subagent')).toBe('agent');
    expect(opencodeToolCategory('skill')).toBe('skill');
    expect(opencodeToolCategory('question')).toBe('plan');
  });

  test('unknown names fall back to other', () => {
    expect(opencodeToolCategory('custom-tool')).toBe('other');
    expect(opencodeToolCategory('')).toBe('other');
  });
});
