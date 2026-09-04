import type { AdapterContext, Diagnostic } from '@scout/core';
import { makeDiagnostic, project, readLinesRaw } from '@scout/core';
import { claudeCodeAllowlist } from './allowlist';
import { type ClaudeCodeRecord, claudeCodeRecordSchema } from './schema';

const KNOWN_IGNORED_TYPES = new Set([
  'last-prompt',
  'agent-name',
  'mode',
  'atis-latch',
  'bridge-session',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'summary',
]);

const HANDLED_TYPES = new Set([
  'assistant',
  'user',
  'system',
  'permission-mode',
  'cost-state',
  'ai-title',
  'attachment',
  // Read for its *presence* only (the dispatch marker); its `agentSetting`
  // payload is not allowlisted and never reaches here.
  'agent-setting',
]);

export type ParsedRecord = { record: ClaudeCodeRecord; line: number };

export type ReadRecordsResult = { diagnostics: Diagnostic[] };

export type ReadRecords = {
  records: AsyncIterable<ParsedRecord>;
  /** Only meaningful after `records` has been fully consumed. */
  result(): ReadRecordsResult;
};

/**
 * Streams a Claude Code session file into allowlisted, schema-checked
 * records (docs/adapters/claude-code.md "Record types"). Replaces the old
 * parse.ts's line-handling half; compute.ts owns turning records into steps.
 *
 * Diagnostics are accumulated internally and only readable via `result()`
 * once the caller has finished iterating `records` (oversized-line,
 * source-truncated and unknown-record-type are file-wide facts only known
 * at end of stream).
 */
export function readRecords(ctx: AdapterContext, path: string): ReadRecords {
  const diagnostics: Diagnostic[] = [];
  let unknownCount = 0;
  const lineResult = { truncated: false, oversizedLines: 0 };

  async function* generate(): AsyncGenerator<ParsedRecord> {
    const stream = ctx.fs.openStream(path);

    for await (const { line, lineNumber } of readLinesRaw(stream, lineResult)) {
      if (line.trim().length === 0) continue;

      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        diagnostics.push(
          makeDiagnostic('warn', 'malformed-json-line', 'Could not parse a line as JSON', {
            line: lineNumber,
          }),
        );
        continue;
      }

      const projected = project(raw, claudeCodeAllowlist);
      const result = claudeCodeRecordSchema.safeParse(projected);
      if (!result.success) {
        diagnostics.push(
          makeDiagnostic('warn', 'invalid-record', 'A record did not match the expected shape', {
            line: lineNumber,
          }),
        );
        continue;
      }

      const record = result.data;
      if (record.type && !HANDLED_TYPES.has(record.type) && !KNOWN_IGNORED_TYPES.has(record.type)) {
        unknownCount++;
      }
      yield { record, line: lineNumber };
    }

    if (lineResult.oversizedLines > 0) {
      diagnostics.push(
        makeDiagnostic(
          'warn',
          'oversized-line',
          `${lineResult.oversizedLines} line(s) exceeded the size cap and were skipped`,
        ),
      );
    }
    if (lineResult.truncated) {
      diagnostics.push(
        makeDiagnostic(
          'info',
          'source-truncated',
          'The final line had no trailing newline; the source may be incomplete',
        ),
      );
    }
    if (unknownCount > 0) {
      diagnostics.push(
        makeDiagnostic(
          'info',
          'unknown-record-type',
          `Saw ${unknownCount} record(s) of an unrecognized type`,
          { count: unknownCount },
        ),
      );
    }
  }

  return {
    records: generate(),
    result: () => ({ diagnostics }),
  };
}
