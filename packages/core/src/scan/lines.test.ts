import { describe, expect, test } from 'bun:test';
import { readLines } from './lines';

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function chunkedStreamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
}

describe('readLines', () => {
  test('splits a well-formed newline-terminated stream and is not truncated', async () => {
    const r = await readLines(streamOf('a\nb\nc\n'));
    expect(r.lines.map((l) => l.line)).toEqual(['a', 'b', 'c']);
    expect(r.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    expect(r.truncated).toBe(false);
    expect(r.oversizedLines).toBe(0);
  });

  test('a final line with no trailing newline is yielded and marks truncated', async () => {
    const r = await readLines(streamOf('a\nb\npartial'));
    expect(r.lines.map((l) => l.line)).toEqual(['a', 'b', 'partial']);
    expect(r.truncated).toBe(true);
  });

  test('an empty stream yields no lines and is not truncated', async () => {
    const r = await readLines(streamOf(''));
    expect(r.lines).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  test('a line above the size cap is skipped, not buffered whole, and counted', async () => {
    const huge = 'x'.repeat(100);
    const r = await readLines(streamOf(`ok1\n${huge}\nok2\n`), 50);
    expect(r.lines.map((l) => l.line)).toEqual(['ok1', 'ok2']);
    expect(r.oversizedLines).toBe(1);
  });

  test('lines split across multiple stream chunks are reassembled correctly', async () => {
    const r = await readLines(chunkedStreamOf(['hel', 'lo\nwor', 'ld\n']));
    expect(r.lines.map((l) => l.line)).toEqual(['hello', 'world']);
  });

  test('strips a trailing carriage return (CRLF line endings)', async () => {
    const r = await readLines(streamOf('a\r\nb\r\n'));
    expect(r.lines.map((l) => l.line)).toEqual(['a', 'b']);
  });

  test('decodes multi-byte UTF-8 characters split across chunk boundaries', async () => {
    const text = 'café\n'; // "café\n"
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4)); // splits the 2-byte é
        controller.enqueue(bytes.slice(4));
        controller.close();
      },
    });
    const r = await readLines(stream);
    expect(r.lines.map((l) => l.line)).toEqual(['café']);
  });
});
