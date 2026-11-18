export type ReadLine = { line: string; lineNumber: number };

export type ReadLinesResult = { truncated: boolean; oversizedLines: number };

const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

export async function* readLinesRaw(
  stream: ReadableStream<Uint8Array>,
  result: ReadLinesResult,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
): AsyncGenerator<ReadLine> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const reader = stream.getReader();
  let buffer = '';
  let lineNumber = 0;
  let endedWithNewline = true;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        lineNumber++;
        endedWithNewline = true;
        if (byteLength(rawLine) > maxLineBytes) {
          result.oversizedLines++;
        } else {
          yield { line: stripCr(rawLine), lineNumber };
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      lineNumber++;
      endedWithNewline = false;
      if (byteLength(buffer) > maxLineBytes) {
        result.oversizedLines++;
      } else {
        yield { line: stripCr(buffer), lineNumber };
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!endedWithNewline && lineNumber > 0) result.truncated = true;
}

export async function readLines(
  stream: ReadableStream<Uint8Array>,
  maxLineBytes?: number,
): Promise<{ lines: ReadLine[] } & ReadLinesResult> {
  const result: ReadLinesResult = { truncated: false, oversizedLines: 0 };
  const lines: ReadLine[] = [];
  for await (const l of readLinesRaw(stream, result, maxLineBytes)) lines.push(l);
  return { lines, ...result };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

function stripCr(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}
