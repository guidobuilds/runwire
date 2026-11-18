export type McpIdentity = {
  server: string;
  tool: string;
};

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
