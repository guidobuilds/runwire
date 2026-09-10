import type { Database } from 'bun:sqlite';
import { profileScopeCte, profileScopeParams } from './profile-scope';
import type { ModelsResponse, ModelUsageEntry, ModelUsageGroup } from './profile-types';

type ModelRow = { model: string; output_tokens: number };

// Own group: the session's own `kind='call'` steps. `model_id IS NOT NULL`
// excludes unknown-model steps from the numerator AND the denominator;
// `SUM`'s NULL-skipping plus `COALESCE` handles an all-NULL-output model.
const OWN_SQL = `
  SELECT m.name AS model, COALESCE(SUM(st.output), 0) AS output_tokens
  FROM steps st
  JOIN models m ON m.id = st.model_id
  WHERE st.kind = 'call' AND st.model_id IS NOT NULL AND st.session_id = ?
  GROUP BY m.name
`;

// Descendants group: the same rows over the recursive parent_id scope CTE
// seeded at the session, EXCLUDING the session itself (`st.session_id <> ?`).
// The CTE uses `UNION`, so a malformed parent cycle admits each id once.
const DESCENDANTS_SQL = `
  SELECT m.name AS model, COALESCE(SUM(st.output), 0) AS output_tokens
  FROM steps st
  JOIN models m ON m.id = st.model_id
  JOIN profile_scope ps ON ps.id = st.session_id
  WHERE st.kind = 'call' AND st.model_id IS NOT NULL AND st.session_id <> ?
  GROUP BY m.name
`;

/**
 * Folds grouped rows into a top-7 + `other` breakdown. Reserved literal names
 * (`unknown`/`other`) never become named entries; every named model outside the
 * top 7 folds too. `other` is emitted only when at least one row folded, so an
 * all-named group never carries an empty `other`.
 */
function buildGroup(rows: readonly ModelRow[]): ModelUsageGroup {
  const total = rows.reduce((sum, row) => sum + row.output_tokens, 0);
  const named: { name: string; outputTokens: number }[] = [];
  let otherTokens = 0;
  let folded = 0;
  for (const row of rows) {
    if (row.model === 'unknown' || row.model === 'other') {
      otherTokens += row.output_tokens;
      folded += 1;
      continue;
    }
    named.push({ name: row.model, outputTokens: row.output_tokens });
  }
  named.sort((a, b) => b.outputTokens - a.outputTokens || a.name.localeCompare(b.name));
  const top = named.slice(0, 7);
  const overflow = named.slice(7);
  for (const row of overflow) otherTokens += row.outputTokens;
  folded += overflow.length;

  const models: ModelUsageEntry[] = top.map((entry) => ({
    model: entry.name,
    outputTokens: entry.outputTokens,
    share: total === 0 ? 0 : entry.outputTokens / total,
  }));
  if (folded > 0) {
    models.push({
      model: 'other',
      outputTokens: otherTokens,
      share: total === 0 ? 0 : otherTokens / total,
    });
  }
  return { outputTokens: total, models };
}

/**
 * Metadata-only OUTPUT-token shares per model for a session's own `kind='call'`
 * steps and for its subagent descendants. Returns null iff the session row does
 * not exist (the transport maps that to a 404); an existing session with no
 * call steps returns two empty groups.
 *
 * Deliberately ignores `sessions.model_primary_id`: the groups are defined over
 * `steps` only, so a primary model that never appears on a call step is not
 * counted (and cannot be double-counted against its call steps).
 */
export function readProfileModels(db: Database, sessionId: string): ModelsResponse | null {
  const exists = db.query('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  if (!exists) return null;

  const ownRows = db.query(OWN_SQL).all(sessionId) as ModelRow[];
  const descendantRows = db
    .query(`${profileScopeCte('tree')}${DESCENDANTS_SQL}`)
    .all(...profileScopeParams(sessionId), sessionId) as ModelRow[];

  return {
    sessionId,
    session: buildGroup(ownRows),
    descendants: buildGroup(descendantRows),
  };
}
