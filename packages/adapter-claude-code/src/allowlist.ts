import type { Projection } from '@runwire/core';

/**
 * The only fields this adapter is permitted to read from a raw Claude Code
 * record (docs/adapters/claude-code.md "Allowlist (projection)"). Anything
 * not named here is dropped by `project()` before validation ever sees it.
 *
 * Explicitly excluded and why: message.content[].text|thinking|content
 * (content) and the rest of `input` (input.args|input.command|input.content —
 * only `input.skill` is allowlisted), everything in `attachment` except
 * `type`/`hookName` (attachments
 * embed file contents, hook stdout and injected context), `toolUseResult`
 * (tool output), `lastPrompt`, `agentName`, `slug` (prompt-derived), `summary`,
 * `agentSetting` (a user-authored agent name; only the *presence* of the
 * `agent-setting` record is read, via the already-allowlisted `type`).
 *
 * `entrypoint` and `promptSource` are closed enums emitted by the CLI itself
 * (the surface the session came in on, and the kind of prompt) - fixed
 * vocabularies with no user- or model-authored content, which is what makes
 * them admissible under D7. See ./initiator.ts for the value spaces.
 */
export const claudeCodeAllowlist: Projection = {
  type: true,
  subtype: true,
  uuid: true,
  parentUuid: true,
  requestId: true,
  timestamp: true,
  cwd: true,
  version: true,
  gitBranch: true,
  isSidechain: true,
  isMeta: true,
  isCompactSummary: true,
  agentId: true,
  entrypoint: true,
  promptSource: true,
  effort: true,
  permissionMode: true,
  durationMs: true,
  totalCostUSD: true,
  aiTitle: true,
  compactMetadata: { trigger: true, preTokens: true, postTokens: true },
  message: {
    role: true,
    model: true,
    stop_reason: true,
    usage: {
      input_tokens: true,
      cache_read_input_tokens: true,
      cache_creation_input_tokens: true,
      output_tokens: true,
      output_tokens_details: { thinking_tokens: true },
    },
    content: [
      {
        type: true,
        name: true,
        id: true,
        tool_use_id: true,
        is_error: true,
        input: { skill: true },
      },
    ],
  },
  attachment: { type: true, hookName: true },
};
