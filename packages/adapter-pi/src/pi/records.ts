import type { AdapterContext, Diagnostic, Projection } from '@runwire/core';
import { makeDiagnostic, project, readLinesRaw } from '@runwire/core';
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
  result(): ReadRecordsResult;
};

export function readRecords(
  ctx: AdapterContext,
  path: string,
  options: { pi12?: boolean; allowlist?: Projection } = {},
): ReadRecords {
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

      const projected = project(raw, options.allowlist ?? piAllowlist);
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
      if (
        record.type &&
        !KNOWN_ENTRY_TYPES.has(record.type) &&
        !(options.pi12 && (record.type === 'usage' || record.type === 'context_edit'))
      ) {
        unknownTypeCount++;
      }
      if (
        record.message?.role &&
        !KNOWN_MESSAGE_ROLES.has(record.message.role) &&
        !(options.pi12 && record.message.role === 'system')
      ) {
        unknownRoleCount++;
      }
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
