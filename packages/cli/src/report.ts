import type { ImportReport } from '@scout/core';

/** One human-readable line per adapter, for `scout import`'s stderr report. */
export function formatReport(report: ImportReport): string {
  const lines: string[] = [];
  for (const [id, r] of Object.entries(report.perAdapter)) {
    let line = `${id}: discovered=${r.discovered} imported=${r.imported} skipped=${r.skipped} removed=${r.removed} failed=${r.failed}`;
    if (r.error) line += ` error=${JSON.stringify(r.error)}`;
    if (r.notes && r.notes.length > 0) line += ` notes=${JSON.stringify(r.notes)}`;
    lines.push(line);
  }
  lines.push(`durationMs=${report.durationMs}`);
  return lines.join('\n');
}
