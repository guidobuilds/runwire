import type { Database } from 'bun:sqlite';
import { makeDiagnostic } from '../contract/diagnostic';

export function linkSessions(db: Database): void {
  const run = db.transaction(() => {
    resolveOrphans(db);
    recoverCausalParents(db);
    fillChildIds(db);
  });
  run();
}

function recoverCausalParents(db: Database): void {
  db.run(
    `UPDATE sessions AS child
     SET parent_id = (
       SELECT MIN(candidate.id)
       FROM steps spawn
       JOIN sessions candidate ON candidate.id = spawn.session_id
       WHERE spawn.kind = 'tool'
         AND spawn.tool_category = 'agent'
         AND spawn.call_id = child.spawn_call_id
         AND candidate.harness_id = child.harness_id
         AND candidate.project_key IS child.project_key
         AND candidate.depth = child.depth - 1
     )
     WHERE child.depth >= 2
       AND child.parent_id IS NOT NULL
       AND child.spawn_call_id IS NOT NULL
       AND 1 = (
         SELECT COUNT(DISTINCT candidate.id)
         FROM steps spawn
         JOIN sessions candidate ON candidate.id = spawn.session_id
         WHERE spawn.kind = 'tool'
           AND spawn.tool_category = 'agent'
           AND spawn.call_id = child.spawn_call_id
           AND candidate.harness_id = child.harness_id
           AND candidate.project_key IS child.project_key
           AND candidate.depth = child.depth - 1
       )`,
  );
}

function resolveOrphans(db: Database): void {
  const orphans = db
    .query(
      `SELECT id FROM sessions
       WHERE parent_id IS NOT NULL AND parent_id NOT IN (SELECT id FROM sessions)`,
    )
    .all() as { id: string }[];

  for (const { id } of orphans) {
    db.run('UPDATE sessions SET parent_id = NULL WHERE id = ?', [id]);
    const diagnostic = makeDiagnostic('warn', 'orphan-child', 'parent session not found');
    db.run('INSERT INTO diagnostics (session_id, level, code, message) VALUES (?, ?, ?, ?)', [
      id,
      diagnostic.level,
      diagnostic.code,
      diagnostic.message,
    ]);
  }
}

function fillChildIds(db: Database): void {
  db.run('UPDATE steps SET child_id = NULL WHERE child_id IS NOT NULL');
  db.run(
    `UPDATE steps
     SET child_id = (
       SELECT MIN(c.id) FROM sessions c
       WHERE c.parent_id = steps.session_id AND c.spawn_call_id = steps.call_id
     )
     WHERE kind = 'tool' AND tool_category = 'agent' AND call_id IS NOT NULL`,
  );
}
