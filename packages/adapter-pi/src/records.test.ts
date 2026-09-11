import { describe, expect, test } from 'bun:test';
import type { AdapterContext, Diagnostic } from '@scout/core';
import { createMemoryFs } from '@scout/core';
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

async function collect(
  ctx: AdapterContext,
): Promise<{ records: unknown[]; diagnostics: Diagnostic[] }> {
  const { records, result } = readRecords(ctx, '/home/u/sess.jsonl');
  const out: unknown[] = [];
  for await (const r of records) out.push(r);
  return { records: out, ...result() };
}

describe('readRecords', () => {
  test('a broken JSON line yields a malformed-json-line diagnostic and skips only that line', async () => {
    const good1 = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const good2 = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const ctx = ctxWith(`${good1}\nnot json at all {\n${good2}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(2);
    expect(diagnostics.some((d) => d.code === 'malformed-json-line' && d.line === 2)).toBe(true);
  });

  test('a projected type mismatch yields invalid-record and is skipped', async () => {
    const bad = JSON.stringify({
      type: 'message',
      message: { role: 'assistant', usage: { input: 'x' } },
    });
    const ctx = ctxWith(`${bad}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === 'invalid-record')).toBe(true);
  });

  test('unknown entry types and unknown message roles aggregate into info diagnostics with counts', async () => {
    const known = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const unknownType1 = JSON.stringify({
      type: 'brand-new-type',
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    const unknownType2 = JSON.stringify({
      type: 'another-type',
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    const unknownRole = JSON.stringify({ type: 'message', message: { role: 'hookMessage' } });
    const ctx = ctxWith(`${known}\n${unknownType1}\n${unknownType2}\n${unknownRole}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(4);
    const typeDiag = diagnostics.find((d) => d.code === 'unknown-entry-type');
    expect(typeDiag?.level).toBe('info');
    expect(typeDiag?.count).toBe(2);
    const roleDiag = diagnostics.find((d) => d.code === 'unknown-message-role');
    expect(roleDiag?.level).toBe('info');
    expect(roleDiag?.count).toBe(1);
  });

  test('a truncated final line (no trailing newline) yields source-truncated but still parses the line', async () => {
    const line1 = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const line2 = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const ctx = ctxWith(`${line1}\n${line2}`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(2);
    expect(diagnostics.some((d) => d.code === 'source-truncated')).toBe(true);
  });

  test('a 9 MB line is skipped with an aggregated oversized-line diagnostic, not buffered whole', async () => {
    const huge = JSON.stringify({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] },
    });
    const ok = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const ctx = ctxWith(`${huge}\n${ok}\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(1);
    const d = diagnostics.find((x) => x.code === 'oversized-line');
    expect(d).toBeDefined();
    expect(d?.count).toBe(1);
    expect(d?.message).toContain('1 line');
  });

  test('blank lines are skipped without a diagnostic', async () => {
    const line1 = JSON.stringify({ type: 'message', message: { role: 'user' } });
    const ctx = ctxWith(`${line1}\n\n\n`);
    const { records, diagnostics } = await collect(ctx);
    expect(records).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

  test('projected records retain only allowlisted keys', async () => {
    const raw = JSON.stringify({
      type: 'message',
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'CANARY',
      message: {
        role: 'assistant',
        model: 'm-a',
        errorMessage: 'CANARY',
        content: [
          { type: 'text', text: 'CANARY' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'CANARY' } },
        ],
      },
    });
    const ctx = ctxWith(`${raw}\n`);
    const { records } = await collect(ctx);
    const rec = records[0] as {
      record: { summary?: unknown; message: { errorMessage?: unknown; content: unknown[] } };
    };
    expect(rec.record.summary).toBeUndefined();
    expect(rec.record.message.errorMessage).toBeUndefined();
    expect(rec.record.message.content).toEqual([
      { type: 'text' },
      { type: 'toolCall', id: 't1', name: 'read' },
    ]);
  });
});
