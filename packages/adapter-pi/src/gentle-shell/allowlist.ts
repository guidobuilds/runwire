import type { Projection } from '@runwire/core';
import { piAllowlist } from '../pi/allowlist';

const usageProjection: Projection = {
  input: true,
  output: true,
  cacheRead: true,
  cacheWrite: true,
  reasoning: true,
  totalTokens: true,
  cost: {
    input: true,
    output: true,
    cacheRead: true,
    cacheWrite: true,
    total: true,
    totalFromProvider: true,
  },
};

const customDataProjection: Projection = {
  schema: true,
  recordedAt: true,
  authority: true,
  aliases: {},
  source: true,
  taskId: true,
  toolCallId: true,
};

export const gentleShellAllowlist: Projection = {
  ...piAllowlist,
  kind: true,
  customType: true,
  data: customDataProjection,
  display: true,
  usage: usageProjection,
  message: {
    role: true,
    api: true,
    provider: true,
    model: true,
    responseModel: true,
    responseId: true,
    providerThinkingLevel: true,
    thinkingLevel: true,
    durationMs: true,
    stopReason: true,
    rawStopReason: true,
    timestamp: true,
    toolCallId: true,
    toolName: true,
    isError: true,
    usage: usageProjection,
    content: [{ type: true, id: true, name: true }],
    nestedCalls: {
      complete: true,
      calls: [{ name: true, status: true, durationMs: true, argumentsBytes: true }],
    },
    details: {
      gentleAgents: { taskId: true, agent: true, mode: true, status: true, cwd: true },
    },
  },
};
