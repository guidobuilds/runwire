import type { Diagnostic } from '../../api/types';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/Table';

const LEVEL_TONE: Record<Diagnostic['level'], BadgeTone> = {
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/**
 * Stable row keys without falling back to the array index: the same diagnostic
 * can legitimately repeat across a subtree, so identical entries get a
 * deterministic occurrence suffix instead of a positional one.
 */
function withKeys(diagnostics: readonly Diagnostic[]): { diagnostic: Diagnostic; key: string }[] {
  const seen = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const base = [
      diagnostic.level,
      diagnostic.code,
      diagnostic.harness,
      diagnostic.path,
      diagnostic.line ?? '',
      diagnostic.message,
    ].join('|');
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { diagnostic, key: occurrence === 0 ? base : `${base}#${occurrence}` };
  });
}

export type DiagnosticsListProps = {
  diagnostics: readonly Diagnostic[];
};

/**
 * Parse diagnostics for this session and its subtree. Paths are operational
 * metadata about the reader's own machine (design.md §7); `message` is capped
 * and newline-free at the source (`makeDiagnostic`), so no record content
 * reaches this view.
 */
export function DiagnosticsList({ diagnostics }: DiagnosticsListProps) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Diagnostics</h2>
      {diagnostics.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No diagnostics for this session.</p>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Level</Th>
              <Th>Code</Th>
              <Th>Message</Th>
              <Th>Count</Th>
              <Th>Source file</Th>
            </Tr>
          </Thead>
          <Tbody>
            {withKeys(diagnostics).map(({ diagnostic, key }) => (
              <Tr key={key}>
                <Td>
                  <Badge tone={LEVEL_TONE[diagnostic.level]}>{diagnostic.level}</Badge>
                </Td>
                <Td className="font-mono text-xs">{diagnostic.code}</Td>
                <Td>{diagnostic.message}</Td>
                <Td numeric>{diagnostic.count ?? 1}</Td>
                <Td className="font-mono text-xs">
                  {diagnostic.line === undefined
                    ? diagnostic.path
                    : `${diagnostic.path}:${diagnostic.line}`}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
