import type { Database } from 'bun:sqlite';

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

export function recomputeRollups(db: Database): void {
  const run = db.transaction(() => {
    db.exec(ROLLUP_SQL);
  });
  run();
}
