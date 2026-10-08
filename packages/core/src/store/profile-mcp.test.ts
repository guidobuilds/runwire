import { describe, expect, test } from 'bun:test';
import { resolveMcpIdentity } from './profile-mcp';

const raw = (toolName: string) => ({
  category: 'mcp',
  toolName,
  mcpServer: null,
  mcpTool: null,
});

describe('resolveMcpIdentity: authoritative stored pair, strict legacy fallback', () => {
  test('a complete stored pair wins over whatever the raw tool name says', () => {
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw_server__raw_tool',
        mcpServer: 'stored-server',
        mcpTool: 'stored_tool',
      }),
    ).toEqual({ server: 'stored-server', tool: 'stored_tool' });
  });

  test('a stored pair still wins even when the raw name is malformed', () => {
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw__tool__extra',
        mcpServer: 'stored-server',
        mcpTool: 'stored_tool',
      }),
    ).toEqual({ server: 'stored-server', tool: 'stored_tool' });
  });

  test('legacy NULL pair: a strict mcp__server__tool name is the only fallback', () => {
    expect(resolveMcpIdentity(raw('mcp__plugin_engram_engram__mem_save'))).toEqual({
      server: 'plugin_engram_engram',
      tool: 'mem_save',
    });
  });

  test('legacy malformed / more delimiters stay unknown', () => {
    expect(resolveMcpIdentity(raw('mcp__server__tool__extra'))).toEqual({
      server: null,
      tool: null,
    });
    expect(resolveMcpIdentity(raw('mcp__server'))).toEqual({ server: null, tool: null });
    expect(resolveMcpIdentity(raw('server__tool'))).toEqual({ server: null, tool: null });
    expect(resolveMcpIdentity(raw('Read'))).toEqual({ server: null, tool: null });
    expect(resolveMcpIdentity(raw(''))).toEqual({ server: null, tool: null });
  });

  test('a partial stored pair is never combined with a parsed, possibly unrelated identity', () => {
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw_server__raw_tool',
        mcpServer: 'stored-server',
        mcpTool: null,
      }),
    ).toEqual({ server: null, tool: null });
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw_server__raw_tool',
        mcpServer: null,
        mcpTool: 'stored_tool',
      }),
    ).toEqual({ server: null, tool: null });
  });

  test('empty stored segments count as absent, never a fabricated empty identity', () => {
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw_server__raw_tool',
        mcpServer: '',
        mcpTool: '',
      }),
    ).toEqual({ server: null, tool: null });
    expect(
      resolveMcpIdentity({
        category: 'mcp',
        toolName: 'mcp__raw_server__raw_tool',
        mcpServer: 'stored-server',
        mcpTool: '',
      }),
    ).toEqual({ server: null, tool: null });
  });

  test('a non-MCP category is never classified from the raw name (no Pi/OpenCode heuristic)', () => {
    expect(
      resolveMcpIdentity({
        category: 'read',
        toolName: 'mcp__server__tool',
        mcpServer: null,
        mcpTool: null,
      }),
    ).toEqual({ server: null, tool: null });
    expect(
      resolveMcpIdentity({
        category: null,
        toolName: 'mcp__server__tool',
        mcpServer: null,
        mcpTool: null,
      }),
    ).toEqual({ server: null, tool: null });
  });

  test('a non-MCP category does not gain an MCP identity from stray stored columns', () => {
    expect(
      resolveMcpIdentity({
        category: 'read',
        toolName: 'Read',
        mcpServer: 'stored-server',
        mcpTool: 'stored_tool',
      }),
    ).toEqual({ server: null, tool: null });
  });
});
