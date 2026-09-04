import type { Diagnostic, DiagnosticLevel } from './types';

const MAX_MESSAGE_LENGTH = 200;

/**
 * The only way to build a contract Diagnostic. Rejects long or multi-line
 * messages so a raw record dump can never slip through as a "diagnostic
 * message" (docs/ARCHITECTURE.md §7). Unlike the legacy `../model/diagnostic`
 * version, the contract Diagnostic carries no `harness`/`path` (ARCHITECTURE
 * §3) - those live on the owning session row instead.
 */
export function makeDiagnostic(
  level: DiagnosticLevel,
  code: string,
  message: string,
  extra?: { line?: number; count?: number },
): Diagnostic {
  if (message.includes('\n')) {
    throw new Error('Diagnostic.message must not contain newlines (would allow record dumps)');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Diagnostic.message must be <= ${MAX_MESSAGE_LENGTH} characters`);
  }
  return { level, code, message, ...extra };
}
