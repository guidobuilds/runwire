import { describe, expect, test } from 'bun:test';
import type { Projection } from './projection';
import { project } from './projection';

describe('project', () => {
  test('keeps only allowlisted leaf keys', () => {
    const record = { type: 'assistant', requestId: 'r1', secret: 'PROMPT TEXT' };
    const allowlist: Projection = { type: true, requestId: true };
    expect(project(record, allowlist)).toEqual({ type: 'assistant', requestId: 'r1' });
  });

  test('recurses into nested objects', () => {
    const record = { message: { model: 'opus', content: 'raw text', usage: { output_tokens: 5 } } };
    const allowlist: Projection = { message: { model: true, usage: { output_tokens: true } } };
    expect(project(record, allowlist)).toEqual({
      message: { model: 'opus', usage: { output_tokens: 5 } },
    });
  });

  test('projects each element of an array', () => {
    const record = {
      content: [
        { type: 'text', text: 'leak me' },
        { type: 'tool_use', name: 'Read', input: { path: '/x' } },
      ],
    };
    const allowlist: Projection = { content: [{ type: true, name: true }] };
    expect(project(record, allowlist)).toEqual({
      content: [{ type: 'text' }, { type: 'tool_use', name: 'Read' }],
    });
  });

  test('drops keys not in the allowlist entirely, including unknown ones', () => {
    const record = { known: 1, unknown: 'whatever this is' };
    expect(project(record, { known: true })).toEqual({ known: 1 });
  });

  test('missing keys are simply absent from the result', () => {
    expect(project({}, { type: true })).toEqual({});
  });

  test('non-object records project to undefined', () => {
    expect(project('a string', { type: true })).toBeUndefined();
    expect(project(null, { type: true })).toBeUndefined();
    expect(project([1, 2], { type: true })).toBeUndefined();
  });

  test('never mutates the source record', () => {
    const record = { type: 'x', nested: { a: 1 } };
    const frozen = structuredClone(record);
    project(record, { type: true, nested: { a: true } });
    expect(record).toEqual(frozen);
  });
});
