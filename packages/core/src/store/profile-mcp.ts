import { parseMcpIdentity } from '../mcp/identity';

/** The resolved MCP identity for one tool step; both null means unknown. */
export type McpIdentityPair = {
  server: string | null;
  tool: string | null;
};

const UNKNOWN: McpIdentityPair = { server: null, tool: null };

/** A stored column is usable only when it is a non-empty string. */
function usable(value: string | null): value is string {
  return value !== null && value !== '';
}

/**
 * Resolves the effective MCP identity for a tool step (docs/session-profile.md:
 * Signals / Merged events).
 *
 * The persisted `mcp_server`/`mcp_tool` pair is authoritative and wins even
 * when the raw tool name would parse to a different identity. Only a row with a
 * NULL pair — legacy rows written before the columns existed — falls back to
 * the strict `parseMcpIdentity` on the raw name, and only for an `mcp`-category
 * tool. A partial stored pair is never combined with a parsed, possibly
 * unrelated identity, a non-MCP category is never classified from the raw name,
 * and anything ambiguous stays unknown (`{server:null,tool:null}`).
 */
export function resolveMcpIdentity(input: {
  category: string | null;
  toolName: string | null;
  mcpServer: string | null;
  mcpTool: string | null;
}): McpIdentityPair {
  if (input.category !== 'mcp') return UNKNOWN;
  if (usable(input.mcpServer) && usable(input.mcpTool)) {
    return { server: input.mcpServer, tool: input.mcpTool };
  }
  if (input.mcpServer === null && input.mcpTool === null && input.toolName !== null) {
    const parsed = parseMcpIdentity(input.toolName);
    if (parsed !== null) return { server: parsed.server, tool: parsed.tool };
  }
  return UNKNOWN;
}
