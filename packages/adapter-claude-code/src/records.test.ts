import { describe, expect, test } from 'bun:test';
import type { AdapterContext } from '@runwire/core';
import { createMemoryFs } from '@runwire/core';
import { readRecords } from './records';

function ctxWith(content: string): AdapterContext {
  return {
    home: '/home/u',
    platform: 'linux',
    env: {},
    fs: createMemoryFs({ files: { '/home/u/sess.jsonl': content } }),
    privacy: { titles: true },
    log: { info() {}, warn() {}, error() {} },
  };
}

async function collect(ctx: AdapterContext) {
  const { records, result } = readRecords(ctx, '/home/u/sess.jsonl');
  const out = [];
  for await (const r of records) out.push(r);
  return { records: out, ...result() };
}

describe('readRecords', () => {
  test('a broken JSON line yields a malformed-json-line diagnostic and skips only that line', async () => {
    const good1 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z' });
    const good2 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01.000Z' });
    const ctx = ctxWith(`${good1}\nnot json at all {\n${good2}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(2);
    expect(diagnostics.some((d) => d.code === 'malformed-json-line' && d.line === 2)).toBe(true);
  });

  test('a 9 MB line is skipped with an aggregated oversized-line diagnostic, not buffered whole', async () => {
    const huge = JSON.stringify({
      type: 'user',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] },
    });
    const ok = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01.000Z' });
    const ctx = ctxWith(`${huge}\n${ok}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(1);
    const d = diagnostics.find((x) => x.code === 'oversized-line');
    expect(d).toBeDefined();
    expect(d?.message).toContain('1 line');
  });

  test('a truncated last line (no trailing newline) yields source-truncated but still parses the line', async () => {
    const line1 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z' });
    const line2 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01.000Z' });
    const ctx = ctxWith(`${line1}\n${line2}`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(2);
    expect(diagnostics.some((d) => d.code === 'source-truncated')).toBe(true);
  });

  test('an unrecognized record type is counted once, aggregated, and does not stop the stream', async () => {
    const known = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z' });
    const unknown1 = JSON.stringify({
      type: 'brand-new-type',
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    const unknown2 = JSON.stringify({
      type: 'another-new-type',
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    const ctx = ctxWith(`${known}\n${unknown1}\n${unknown2}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(3);
    const d = diagnostics.find((x) => x.code === 'unknown-record-type');
    expect(d?.count).toBe(2);
  });

  test('a record that fails schema validation yields invalid-record and is skipped', async () => {
    const bad = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { model: 'x', usage: { input_tokens: 'not-a-number' } },
    });
    const ctx = ctxWith(`${bad}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === 'invalid-record')).toBe(true);
  });

  test('a known-ignored type is never counted as unknown', async () => {
    const known = JSON.stringify({ type: 'summary', timestamp: '2026-01-01T00:00:00.000Z' });
    const ctx = ctxWith(`${known}\n`);
    const { diagnostics } = await collect(ctx);
    expect(diagnostics.some((d) => d.code === 'unknown-record-type')).toBe(false);
  });

  test('blank lines are skipped without a diagnostic', async () => {
    const line1 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z' });
    const ctx = ctxWith(`${line1}\n\n\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });
});
