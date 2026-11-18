import type { Diagnostic, DiagnosticLevel } from './types';

const MAX_MESSAGE_LENGTH = 200;

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
