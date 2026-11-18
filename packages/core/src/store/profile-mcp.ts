import { parseMcpIdentity } from '../mcp/identity';

export type McpIdentityPair = {
  server: string | null;
  tool: string | null;
};

const UNKNOWN: McpIdentityPair = { server: null, tool: null };

function usable(value: string | null): value is string {
  return value !== null && value !== '';
}

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
