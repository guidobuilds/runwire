import type { Projection } from '@runwire/core';
import { piAllowlist } from '../pi/allowlist';

/** Shared by the entry-level `usage` and `message.usage` (same shape, §7). */
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
    // Pi 1.5.0: whether the provider itself reported the total (a boolean, so
    // it leaks no rates or content).
    totalFromProvider: true,
  },
};

/**
 * The only fields this adapter is permitted to read from a raw Pi v3 record
 * (docs/adapters/gentle-shell.md §7). Same base as `piAllowlist` plus the Pi 1.2
 * and Pi 1.5.0 additions and the Gentle Shell extension metadata.
 *
 * Pi 1.5.0 adds metadata only: assistant `message.rawStopReason` (provider
 * stop-reason string, never message text), `usage.cost.totalFromProvider` and
 * `custom_message.display` (both booleans). `providerThinkingLevel` was already
 * projected before that delta and is left untouched until real data confirms it.
 *
 * Excluded, each with its content hazard (gentle-shell.md §7 table) — the Pi
 * exclusions above plus:
 * - `message.details` — `edit` writes `diff`+`patch`, `todo` task titles,
 *   `ask_user_*` question/options/answers, `bash` truncation previews. Only
 *   `details.gentleAgents.{taskId,agent,mode,status,cwd}` is projected, and
 *   only because it is the spawn identity (§5.1).
 * - `custom.data` — `gentle-todo-state` titles, `session-change` before/after
 *   diffs, published-state prose, web search results, job notices. Only the
 *   bounded marker in `customDataProjection` survives.
 * - `custom_message.content` / `custom_message.details` — child answers, wake
 *   notices (`gentle-pi.exploration-budget` details included). `customType` is
 *   projected as a namespace only, never the payload.
 * - `context_edit.replacement`, `compaction.summary/details/systemMessage`,
 *   `branch_summary.summary/details` — rewritten context and summaries.
 * - `label.label`, `session_info.name` — user-authored text (D78).
 * - ledger `prompt/result/error/label/lastStep/thread` — child prompt, answer
 *   and transcript (the ledger has its own link-metadata-only read, §2.2).
 */
/**
 * Bounded `custom.data` projection (S3). The projection mechanism is per-key and
 * not per-`customType`, so only keys that are metadata under every observed
 * customType are named here:
 *
 * - `schema`/`recordedAt`/`authority` — the `gentle-agents.published-state`
 *   orchestrator marker (a number, a timestamp, a role name).
 * - `aliases` — an EMPTY rule, so the record keeps the aliases object only when
 *   it is an object and collapses every alias id: presence without the values.
 *   The mechanism cannot turn a leaf into a boolean, and alias ids are strings
 *   of unknown length, so presence-only is what it can express.
 * - `source`/`taskId`/`toolCallId` — the `gentle-pi.review-reminder-receipt/v1`
 *   spawn identity that `discover` corroborates (`source === 'subagent'`).
 *
 * Everything else in `data` (published-state `state` prose and `ownerReply`,
 * todo titles, session-change before/after, results, messages) stays unread.
 */
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
  // Pi 1.2 / Gentle Shell entry-level metadata.
  kind: true,
  customType: true,
  // Gentle Shell 4.x: the bounded custom-entry marker + spawn identity (§5.1,
  // §9). Content hazards of `custom.data` are listed above.
  data: customDataProjection,
  // Pi 1.5.0: whether a custom_message is surfaced in the TUI (boolean; the
  // `content` it would surface stays excluded).
  display: true,
  // Same shared projection as `message.usage`, so a compaction/branch entry
  // usage carries `cost.totalFromProvider` too.
  usage: usageProjection,
  message: {
    // Spell the whole envelope out so nothing silently diverges from
    // `piAllowlist`; the shared usage projection keeps the token/cost leaves
    // identical between the two adapters.
    role: true,
    api: true,
    provider: true,
    model: true,
    responseModel: true,
    responseId: true,
    providerThinkingLevel: true,
    // Pi 1.2: per-response thinking level and persisted durations.
    thinkingLevel: true,
    durationMs: true,
    stopReason: true,
    // Pi 1.5.0: the provider's own stop-reason string (metadata, not text).
    rawStopReason: true,
    timestamp: true,
    toolCallId: true,
    toolName: true,
    isError: true,
    usage: usageProjection,
    content: [{ type: true, id: true, name: true }],
    // Pi 1.2: bounded nested tool-call metadata (codemode). Not model-issued,
    // so compute never steps them; `nested-tool-calls` keeps them visible.
    nestedCalls: {
      complete: true,
      calls: [{ name: true, status: true, durationMs: true, argumentsBytes: true }],
    },
    // The ONLY details projection: subagent spawn identity, no prompt/result/
    // diff/todo text (gentle-shell.md §5.1/§7).
    details: {
      gentleAgents: { taskId: true, agent: true, mode: true, status: true, cwd: true },
    },
  },
};
