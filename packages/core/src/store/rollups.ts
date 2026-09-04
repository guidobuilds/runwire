import type { Database } from 'bun:sqlite';

// docs/ARCHITECTURE.md §6 / plan.md §1, spiked in grill.md §3 (bun 1.3.10).
// `db.prepare()` runs only the first statement of a multi-statement string
// (lessons `bun-sqlite-self-fk-rejects-orphans-and-prepare-is-single-
// statement`), so this goes through `db.exec()` inside one
// `db.transaction()`. The `instr(path, ',' || id || ',')` guard stops a
// hand-made parent cycle from looping forever and ensures each cycle member
// is summed into its own tree exactly once.
const ROLLUP_SQL = `
DELETE FROM rollups;
INSERT INTO rollups (session_id, uncached_input, cached_input, cache_write, output, reasoning_output, api_calls, tool_calls, compactions, descendants)
WITH RECURSIVE tree(ancestor_id, id, path) AS (
  SELECT id, id, ',' || id || ',' FROM sessions
  UNION ALL
  SELECT t.ancestor_id, s.id, t.path || s.id || ','
  FROM tree t JOIN sessions s ON s.parent_id = t.id
  WHERE instr(t.path, ',' || s.id || ',') = 0
)
SELECT t.ancestor_id,
  SUM(s.uncached_input), SUM(s.cached_input), SUM(s.cache_write), SUM(s.output), SUM(s.reasoning_output),
  SUM(s.api_calls), SUM(s.tool_calls), SUM(s.compactions), COUNT(*) - 1
FROM tree t JOIN sessions s ON s.id = t.id
GROUP BY t.ancestor_id;
`;

/**
 * Rewrites the whole `rollups` table: one row per session with inclusive
 * (own + all descendants) totals for the five token fields, `api_calls`,
 * `tool_calls`, `compactions`, and `descendants` = count. `turns` is never
 * rolled up (read from the root row). SUM stays NULL when every
 * contributor is NULL (SQLite semantics). Idempotent: rerunning with
 * unchanged `sessions` data rewrites the same rows.
 */
export function recomputeRollups(db: Database): void {
  const run = db.transaction(() => {
    db.exec(ROLLUP_SQL);
  });
  run();
}
