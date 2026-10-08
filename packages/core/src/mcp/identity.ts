/**
 * Normalized MCP identity (docs/ARCHITECTURE.md §3): the two `__`-delimited
 * segments between the fixed `mcp` prefix and the tool name.
 */
export type McpIdentity = {
  server: string;
  tool: string;
};

/**
 * Strict, pure parser for a PROVEN MCP tool identity. Only an exact
 * `mcp__<server>__<tool>` name with three nonempty `__`-separated segments is
 * accepted; `plugin_engram_engram` is a valid server because single
 * underscores are ordinary segment content. Anything else (fewer/more
 * segments, a missing/empty prefix or segment, a non-`mcp` name) returns
 * `null` so the caller keeps the raw tool name and fabricates no identity.
 * Never mutates or trims its input.
 */
export function parseMcpIdentity(toolName: string): McpIdentity | null {
  const parts = toolName.split('__');
  if (parts.length !== 3) return null;

  const prefix = parts[0];
  const server = parts[1];
  const tool = parts[2];
  if (prefix !== 'mcp') return null;
  if (server === undefined || server === '' || tool === undefined || tool === '') return null;

  return { server, tool };
}
