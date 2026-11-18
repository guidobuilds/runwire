import type { Database, SQLQueryBindings } from 'bun:sqlite';
import type { ProfileNode, ProfileScope } from './profile-types';

const PROFILE_SCOPE_CTE = 'profile_scope';

export function profileScopeCte(scope: ProfileScope): string {
  if (scope === 'own') {
    return `WITH RECURSIVE ${PROFILE_SCOPE_CTE}(id) AS (
      SELECT id FROM sessions WHERE id = ?
    )`;
  }
  return `WITH RECURSIVE ${PROFILE_SCOPE_CTE}(id) AS (
    SELECT id FROM sessions WHERE id = ?
    UNION
    SELECT child.id
    FROM sessions child
    JOIN ${PROFILE_SCOPE_CTE} parent ON child.parent_id = parent.id
  )`;
}

export function profileScopeParams(sessionId: string): SQLQueryBindings[] {
  return [sessionId];
}

export function profileScopeMembershipSql(tableAlias: string): string {
  return `${tableAlias}.id IN (SELECT id FROM ${PROFILE_SCOPE_CTE})`;
}

export function profileNodeOrderSql(tableAlias: string): string {
  return `ORDER BY CASE WHEN ${tableAlias}.id = ? THEN 0 ELSE 1 END, ${tableAlias}.id COLLATE BINARY`;
}

type ProfileNodeRow = {
  id: string;
  parent_id: string | null;
  relation: ProfileNode['relation'];
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export function readProfileScopeNodes(
  db: Database,
  sessionId: string,
  scope: ProfileScope,
): ProfileNode[] | null {
  const exists = db.query('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!exists) return null;

  const rows = db
    .query(
      `${profileScopeCte(scope)}
       SELECT s.id, s.parent_id, s.relation, s.agent_type, s.started_at, s.ended_at
       FROM sessions s
       WHERE ${profileScopeMembershipSql('s')}
       ${profileNodeOrderSql('s')}`,
    )
    .all(...profileScopeParams(sessionId), sessionId) as ProfileNodeRow[];

  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    relation: row.relation,
    agentType: row.agent_type,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }));
}

export function isProfileScopeMember(
  db: Database,
  sessionId: string,
  scope: ProfileScope,
  memberId: string,
): boolean {
  const row = db
    .query(
      `${profileScopeCte(scope)}
       SELECT 1 FROM ${PROFILE_SCOPE_CTE} WHERE id = ?`,
    )
    .get(...profileScopeParams(sessionId), memberId);
  return row !== null;
}
