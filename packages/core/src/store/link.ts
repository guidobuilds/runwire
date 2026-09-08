import type { Database } from 'bun:sqlite';
import { makeDiagnostic } from '../contract/diagnostic';

/**
 * ARCHITECTURE §6 / plan P2 (ADR 0001). Two passes inside one transaction:
 * (1) any session whose `parent_id` does not resolve to a real session gets
 * `parent_id` set NULL (depth/relation left as declared by the adapter -
 * plan P7) plus a warn `orphan-child` diagnostic, and becomes a root; (2)
 * a depth-2+ session flattened onto the root is reparented when exactly one
 * agent at the preceding depth owns the matching spawn call; (3)
 * `steps.child_id` is reset to NULL for every step, then set on `tool`
 * steps with `tool_category = 'agent'` to the child whose `parent_id` is
 * that session and whose `spawn_call_id` equals the step's `call_id`,
 * `MIN(child.id)` breaking a collision deterministically. Doing this as set
 * operations (not an app-level loop over insertion order) makes both passes
 * naturally order-independent and idempotent.
 */
export function linkSessions(db: Database): void {
  const run = db.transaction(() => {
    resolveOrphans(db);
    recoverCausalParents(db);
    fillChildIds(db);
  });
  run();
}

/**
 * Some harnesses report a useful `depth` and `spawn_call_id`, but identify the
 * root session as every descendant's parent. Recover the immediate parent from
 * the stronger causal evidence: an agent tool step at depth N-1 with the same
 * call id. The candidate must be unique and belong to the same harness,
 * project, and preceding depth. Repeated call ids therefore remain ambiguous
 * rather than cross-linking unrelated sessions.
 *
 * The operation is idempotent. Ambiguous or absent evidence leaves the
 * adapter-declared relationship untouched.
 */
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
