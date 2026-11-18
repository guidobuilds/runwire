import type { Projection } from '@runwire/core';

export const opencodeAllowlist: Projection = {
  type: true,
  role: true,
  model: { id: true, providerID: true },
  previous: { id: true },
  time: { created: true, completed: true, streamed: true },
  tokens: {
    input: true,
    output: true,
    reasoning: true,
    cache: { read: true, write: true },
  },
  content: [
    {
      type: true,
      id: true,
      name: true,
      tool: true,
      time: { created: true, completed: true },
      state: { status: true, metadata: { sessionID: true } },
    },
  ],
  reason: true,
};

export const sessionRowAllowlist: Projection = {
  id: true,
  project_id: true,
  parent_id: true,
  fork_session_id: true,
  directory: true,
  title: true,
  agent: true,
  model: true,
  version: true,
  cost: true,
  time_created: true,
  time_updated: true,
  time_suspended: true,
  tokens_input: true,
  tokens_output: true,
  tokens_reasoning: true,
  tokens_cache_read: true,
  tokens_cache_write: true,
};
