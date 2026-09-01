import type { Diagnostic } from '../../api/types';
import { Badge, type BadgeTone } from '../primitives/Badge';
import { ConfidenceDot } from '../primitives/ConfidenceDot';
import { Table, Tbody, Td, Th, Thead, Tr } from '../primitives/Table';

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
 * Fixed banner text (design.md §5: "fixed message text"). Deliberately
 * generic and independent of any individual diagnostic's content — the
 * banner's job is to be visibly different from a clean session before
 * anyone opens or reads anything (brief §4.4), not to summarize what went
 * wrong; the table below carries the specifics.
 */
const BANNER_TEXT = 'This session has data-quality diagnostics.';

/**
 * Amber "this session is not clean" banner (D36's `--confidence-medium`
 * token family — this is the one place outside a `Metric` grade that token
 * is reused for, per design.md §3's own note that the token is "also used by
 * the diagnostics banner"). Distinguishable from a clean session by role and
 * text alone, not by color: `role="status"` plus the fixed banner text is
 * the actual signal; the `ConfidenceDot` and the amber accent are additive,
 * not the only channel (D36 — color is never the sole channel).
 *
 * Background is `bg-card`, not `bg-muted` (f9 integration-hardening fix):
 * `--confidence-medium` text on `--muted` measures 3.89:1 in light mode
 * (independently recomputed WCAG relative-luminance contrast), below the
 * 4.5:1 AA text bar f1's verification established for this token family --
 * `--muted` was never one of the surfaces f1 actually checked against (only
 * `--card`), and this banner is the one real call site that put confidence-
 * colored text on it. `bg-card` measures 4.59:1 light / 9.12:1 dark, both
 * clearing AA, and reads as a raised banner against the page's own
 * `--background` either way.
 */
function DiagnosticsBanner({ count }: { count: number }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border-l-4 border-[var(--confidence-medium)] bg-card px-3 py-2 text-sm"
    >
      <ConfidenceDot level="medium" decorative />
      <span className="font-medium text-[var(--confidence-medium)]">{BANNER_TEXT}</span>
      <span className="text-zinc-500 dark:text-zinc-400">
        {`${count} ${count === 1 ? 'entry' : 'entries'} below.`}
      </span>
    </div>
  );
}

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
        <>
          <DiagnosticsBanner count={diagnostics.length} />
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
        </>
      )}
    </section>
  );
}
