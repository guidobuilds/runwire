import type { Projection } from '@scout/core';

/**
 * The only fields this adapter is permitted to read from a raw Pi record
 * (docs/adapters/pi.md §7). `project()` runs before validation, so anything
 * not named here never reaches a schema, a step or a diagnostic.
 *
 * Excluded, each with its content hazard (pi.md §7 table):
 * - `message.content[].text` / `thinking` / `textSignature` — prompts, answers,
 *   reasoning text.
 * - `message.content[].arguments` — ALL tool input, and the only place skill
 *   names appear (D79).
 * - `message.details` — tool output metadata: `edit` writes `diff`+`patch`,
 *   `todo` writes task titles/notes, `gentle_review` writes prose.
 * - `message.errorMessage` / `message.diagnostics` — provider error text and
 *   extracted `Error` objects.
 * - `summary` — compaction/branch summaries.
 * - `retainedTail[*]` — materialized context (whole messages); kept as the
 *   presence-only `[{}]` idiom below.
 * - `custom.data`, `custom_message.content`, `label.label` — arbitrary
 *   extension state / injected context / user bookmark text.
 * - `session_info.name` — a user-authored display name, so it is excluded (D78:
 *   D7's exception covers harness-generated titles only). `title` is never set.
 * - `message.content[].mimeType` / `data` — base64 image payloads.
 * - `addedToolNames` — names extension tools per result; kept out of v1.
 */
export const piAllowlist: Projection = {
  // header
  type: true,
  version: true,
  id: true,
  parentId: true,
  timestamp: true,
  cwd: true,
  parentSession: true,
  // entry-level metadata
  thinkingLevel: true,
  provider: true,
  modelId: true,
  tokensBefore: true,
  fromHook: true,
  // usage on a compaction / branch_summary entry (NOT inside `message`) — §5.2
  usage: {
    input: true,
    output: true,
    cacheRead: true,
    cacheWrite: true,
    reasoning: true,
    totalTokens: true,
    cost: { input: true, output: true, cacheRead: true, cacheWrite: true, total: true },
  },
  firstKeptEntryId: true,
  // §7/§8 reconciliation: §7 names `firstKeptEntryId`, §8's legacy-format rule
  // names `firstKeptEntryIndex`; both are presence-only and neither value is read.
  firstKeptEntryIndex: true,
  retainedTail: [{}],
  // message envelope
  message: {
    role: true,
    api: true,
    provider: true,
    model: true,
    responseModel: true,
    responseId: true,
    providerThinkingLevel: true,
    stopReason: true,
    timestamp: true,
    toolCallId: true,
    toolName: true,
    isError: true,
    usage: {
      input: true,
      output: true,
      cacheRead: true,
      cacheWrite: true,
      reasoning: true,
      totalTokens: true,
      cost: { input: true, output: true, cacheRead: true, cacheWrite: true, total: true },
    },
    content: [{ type: true, id: true, name: true }],
  },
};
