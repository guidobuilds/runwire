import type { Projection } from '@runwire/core';

/**
 * The metadata-only projection for a raw OpenCode `session_message.data` object
 * (the content-bearing record). Anything not named here is dropped by
 * `project()` before validation ever sees it, so the canary sentinel planted in
 * content can never reach a bundle. This is the ONLY projection the connector
 * uses, so the connector returns exactly the non-sensitive CORE-representable
 * data the bundle path produces.
 *
 * Explicitly excluded and why: `text` (top-level prompt/reasoning text),
 * `content[].text` (message content), `content[].state.reasoningEncryptedContent`
 * (encrypted reasoning), `content[].state.input` / `content[].state.content` /
 * `content[].state.error.message` (tool IO / error text), `snapshot`, `summary`,
 * `recent`, `metadata`, `share_url`, `revert`, `instruction_*` values. Only
 * `content[].state.status` is kept — it is the metadata used to mark a tool step
 * `error`, and it carries no content. `state.metadata.sessionID` is the sole
 * metadata key retained: it is an opaque identifier used to link an explicit
 * subagent call to the child session declared by `session_v2.parent_id`.
 */
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
      // Current OpenCode uses `name`; `tool` is retained for legacy stores.
      name: true,
      tool: true,
      time: { created: true, completed: true },
      state: { status: true, metadata: { sessionID: true } },
    },
  ],
  reason: true,
};

/**
 * Metadata-only projection for a raw `session_v2` / `session` row. Session rows
 * are already metadata, but `SELECT *` would surface `summary_diffs`,
 * `metadata`, `share_url`, `revert`, `permission` and `slug` — so the
 * projection keeps only the metadata columns the adapter reads. The
 * `tokens_*` aggregate columns are kept (they are numeric metadata used only to
 * emit the `token-total-drift` diagnostic; the session token fields themselves
 * are always recomputed as the Σ of call-step tokens).
 */
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
