import type { Database } from 'bun:sqlite';
import { resolveMcpIdentity } from './profile-mcp';
import { profileScopeCte, profileScopeParams, readProfileScopeNodes } from './profile-scope';
import type { SignalsQuery, SignalsResponse } from './profile-types';

type StepRow = {
  kind: string;
  tool_category: string | null;
  tool_name: string | null;
  mcp_server: string | null;
  mcp_tool: string | null;
  skill_name: string | null;
  compaction_trigger: string | null;
};

/**
 * Metadata-only signals reader: waste-pattern counts (compactions, model
 * changes, MCP/skill tool calls) aggregated over the scope's `steps`, not
 * `session_tool_counts` — sharing the same code path as every other profile
 * reader instead of a second, adapter-populated aggregate that could drift.
 */
export function readProfileSignals(
  db: Database,
  sessionId: string,
  query: SignalsQuery = {},
): SignalsResponse | null {
  const scope = query.scope ?? 'tree';
  const nodes = readProfileScopeNodes(db, sessionId, scope);
  if (nodes === null) return null;

  const prefix = profileScopeCte(scope);
  const params = profileScopeParams(sessionId);
  const rowsSql = `${prefix}
       SELECT st.kind, st.tool_category, st.tool_name, st.mcp_server, st.mcp_tool,
              st.skill_name, st.compaction_trigger
       FROM steps st JOIN profile_scope ps ON ps.id = st.session_id
       WHERE st.kind IN ('compaction', 'model-change', 'tool')`;
  const rows = db.query(rowsSql).all(...params) as StepRow[];

  let auto = 0;
  let manual = 0;
  let unknown = 0;
  let modelChanges = 0;
  let toolTotal = 0;
  let toolMcp = 0;
  let skillCalls = 0;
  const mcpServers = new Set<string>();
  const skillNames = new Set<string>();

  for (const row of rows) {
    if (row.kind === 'compaction') {
      if (row.compaction_trigger === 'auto') auto += 1;
      else if (row.compaction_trigger === 'manual') manual += 1;
      else unknown += 1;
    } else if (row.kind === 'model-change') {
      modelChanges += 1;
    } else if (row.kind === 'tool') {
      toolTotal += 1;
      if (row.tool_category === 'mcp') {
        toolMcp += 1;
        const identity = resolveMcpIdentity({
          category: row.tool_category,
          toolName: row.tool_name,
          mcpServer: row.mcp_server,
          mcpTool: row.mcp_tool,
        });
        if (identity.server !== null) mcpServers.add(identity.server);
      } else if (row.tool_category === 'skill') {
        skillCalls += 1;
        if (row.skill_name !== null) skillNames.add(row.skill_name);
      }
    }
  }

  return {
    sessionId,
    scope,
    compactions: { auto, manual, unknown },
    modelChanges,
    toolCalls: { total: toolTotal, mcp: toolMcp },
    mcpServers: [...mcpServers].sort(),
    skillCalls,
    skillNames: [...skillNames].sort(),
  };
}
