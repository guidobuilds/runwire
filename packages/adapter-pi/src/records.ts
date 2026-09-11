import type { AdapterContext, Diagnostic } from '@scout/core';
import { makeDiagnostic, project, readLinesRaw } from '@scout/core';
import { piAllowlist } from './allowlist';
import { type PiRecord, piRecordSchema } from './schema';

const KNOWN_ENTRY_TYPES = new Set([
  'session',
  'message',
  'model_change',
  'thinking_level_change',
  'compaction',
  'branch_summary',
  'custom',
  'custom_message',
  'label',
  'session_info',
]);

const KNOWN_MESSAGE_ROLES = new Set([
  'user',
  'assistant',
  'toolResult',
  'bashExecution',
  'custom',
  'branchSummary',
  'compactionSummary',
]);

export type ParsedRecord = { record: PiRecord; line: number };

export type ReadRecordsResult = { diagnostics: Diagnostic[] };

export type ReadRecords = {
  records: AsyncIterable<ParsedRecord>;
  /** Only meaningful after `records` has been fully consumed. */
  result(): ReadRecordsResult;
};

/**
 * Streams a Pi session file into allowlisted, schema-checked records
 * (docs/adapters/pi.md §7–§8). Pi's extension surface makes unknown entry
 * types and message roles *expected*, so both are aggregated at `info`
 * (unlike a malformed line, which is `warn`).
 */
export function readRecords(ctx: AdapterContext, path: string): ReadRecords {
  const diagnostics: Diagnostic[] = [];
  let unknownTypeCount = 0;
  let unknownRoleCount = 0;
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

      const projected = project(raw, piAllowlist);
      const result = piRecordSchema.safeParse(projected);
      if (!result.success) {
        diagnostics.push(
          makeDiagnostic('warn', 'invalid-record', 'A record did not match the expected shape', {
            line: lineNumber,
          }),
        );
        continue;
      }

      const record = result.data;
      if (record.type && !KNOWN_ENTRY_TYPES.has(record.type)) unknownTypeCount++;
      if (record.message?.role && !KNOWN_MESSAGE_ROLES.has(record.message.role)) unknownRoleCount++;
      yield { record, line: lineNumber };
    }

    if (lineResult.oversizedLines > 0) {
      diagnostics.push(
        makeDiagnostic(
          'warn',
          'oversized-line',
          `${lineResult.oversizedLines} line(s) exceeded the size cap and were skipped`,
          { count: lineResult.oversizedLines },
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
    if (unknownTypeCount > 0) {
      diagnostics.push(
        makeDiagnostic(
          'info',
          'unknown-entry-type',
          `Saw ${unknownTypeCount} entry(ies) of an unrecognized type`,
          { count: unknownTypeCount },
        ),
      );
    }
    if (unknownRoleCount > 0) {
      diagnostics.push(
        makeDiagnostic(
          'info',
          'unknown-message-role',
          `Saw ${unknownRoleCount} message(s) with an unrecognized role`,
          { count: unknownRoleCount },
        ),
      );
    }
  }

  return {
    records: generate(),
    result: () => ({ diagnostics }),
  };
}
