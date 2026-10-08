import { describe, expect, test } from 'bun:test';
import { parseMcpIdentity } from './identity';

describe('parseMcpIdentity: exactly three nonempty __ segments (mcp__server__tool)', () => {
  test('parses the canonical mcp__server__tool shape', () => {
    expect(parseMcpIdentity('mcp__server__tool')).toEqual({ server: 'server', tool: 'tool' });
  });

  test('parses a server name containing single underscores (plugin_engram_engram)', () => {
    expect(parseMcpIdentity('mcp__plugin_engram_engram__mem_save')).toEqual({
      server: 'plugin_engram_engram',
      tool: 'mem_save',
    });
  });

  test('parses a tool name containing single underscores', () => {
    expect(parseMcpIdentity('mcp__srv__my_tool_v2')).toEqual({
      server: 'srv',
      tool: 'my_tool_v2',
    });
  });

  test('a second __ inside a segment is not identity: more segments return null', () => {
    expect(parseMcpIdentity('mcp__server__tool__extra')).toBeNull();
    expect(parseMcpIdentity('mcp__a__b__c__d')).toBeNull();
  });

  test('fewer than three segments return null', () => {
    expect(parseMcpIdentity('')).toBeNull();
    expect(parseMcpIdentity('mcp')).toBeNull();
    expect(parseMcpIdentity('mcp__server')).toBeNull();
    expect(parseMcpIdentity('server__tool')).toBeNull();
  });

  test('a missing/empty prefix is not a proven identity', () => {
    expect(parseMcpIdentity('__server__tool')).toBeNull();
    expect(parseMcpIdentity('server__x__tool')).toBeNull();
    expect(parseMcpIdentity('mcpx__server__tool')).toBeNull();
  });

  test('empty server or tool segments return null', () => {
    expect(parseMcpIdentity('mcp____tool')).toBeNull();
    expect(parseMcpIdentity('mcp__server__')).toBeNull();
    expect(parseMcpIdentity('mcp____')).toBeNull();
    expect(parseMcpIdentity('__')).toBeNull();
  });

  test('the raw tool name is never mutated or trimmed (caller keeps it verbatim)', () => {
    const raw = 'mcp__server__tool';
    parseMcpIdentity(raw);
    expect(raw).toBe('mcp__server__tool');

    const malformed = 'mcp__server__tool__extra';
    expect(parseMcpIdentity(malformed)).toBeNull();
    expect(malformed).toBe('mcp__server__tool__extra');
  });
});
