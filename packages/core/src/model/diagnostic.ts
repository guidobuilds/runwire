import type { HarnessId } from './harness';

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export type Diagnostic = {
  level: DiagnosticLevel;
  /** e.g. "unknown-record-type", "usage-total-mismatch", "no-cwd". */
  code: string;
  /** Never contains record content. */
  message: string;
  harness: HarnessId;
  path: string;
  line?: number;
  /** Aggregated duplicate count, when the same diagnostic recurs many times. */
  count?: number;
};

const MAX_MESSAGE_LENGTH = 200;

/**
 * The only way to build a Diagnostic. Rejects long or multi-line messages so
 * a raw record dump can never slip through as a "diagnostic message"
 * (docs/ARCHITECTURE.md §6, mechanism 4).
 */
export function makeDiagnostic(input: Diagnostic): Diagnostic {
  if (input.message.includes('\n')) {
    throw new Error('Diagnostic.message must not contain newlines (would allow record dumps)');
  }
  if (input.message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Diagnostic.message must be <= ${MAX_MESSAGE_LENGTH} characters`);
  }
  return input;
}
