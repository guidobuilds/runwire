import { basename, dirname, join } from 'node:path';
import type { AdapterContext, ScoutEvent, SourceRef } from '@scout/core';
import { project, readLines } from '@scout/core';
import { claudeCodeAllowlist } from './allowlist';
import { classifyInitiator } from './initiator';
import { type ClaudeCodeRecord, claudeCodeRecordSchema, parseMetaJson } from './schema';
import { claudeCodeToolCategory, hookEventName } from './tool-category';

const KNOWN_IGNORED_TYPES = new Set([
  'last-prompt',
  'agent-name',
  'mode',
  'atis-latch',
  'bridge-session',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'summary',
]);

const HANDLED_TYPES = new Set([
  'assistant',
  'user',
  'system',
  'permission-mode',
  'cost-state',
  'ai-title',
  'attachment',
  // Read for its *presence* only (the dispatch marker, see DISPATCH_MARKER_TYPE);
  // its `agentSetting` payload is not allowlisted and never reaches here.
  'agent-setting',
]);

/**
 * Claude Code writes this record when the session was dispatched by another
 * agent rather than opened by a person. Orthogonal to `entrypoint`, which
 * reports `cli` for such sessions just like a real terminal session.
 */
const DISPATCH_MARKER_TYPE = 'agent-setting';

type Parsed = { record: ClaudeCodeRecord; line: number };

/**
 * Streams a Claude Code session file into ScoutEvents
 * (docs/adapters/claude-code.md "Record types and what is taken from them").
 *
 * Two passes over the same (small, already-projected) in-memory record
 * array: the first determines file-wide facts a *streaming* single pass
 * cannot know yet (does this file report turn_duration at all? what is the
 * session's initial cwd/version/title?), which the `meta` event - required
 * to be first - needs. The second pass emits events in source order. Only
 * the allowlisted projection of each record is ever held in memory; content
 * fields never survive `project()`.
 */
export async function* parse(ref: SourceRef, ctx: AdapterContext): AsyncIterable<ScoutEvent> {
  const stream = ctx.fs.openStream(ref.path);
  const { lines, truncated, oversizedLines } = await readLines(stream);

  const parsed: Parsed[] = [];
  const preDiagnostics: ScoutEvent[] = [];
  let unknownCount = 0;

  for (const { line, lineNumber } of lines) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      preDiagnostics.push({
        kind: 'diagnostic',
        level: 'warn',
        code: 'malformed-json-line',
        message: 'Could not parse a line as JSON',
        line: lineNumber,
      });
      continue;
    }

    const projected = project(raw, claudeCodeAllowlist);
    const result = claudeCodeRecordSchema.safeParse(projected);
    if (!result.success) {
      preDiagnostics.push({
        kind: 'diagnostic',
        level: 'warn',
        code: 'invalid-record',
        message: 'A record did not match the expected shape',
        line: lineNumber,
      });
      continue;
    }

    const record = result.data;
    if (record.type && !HANDLED_TYPES.has(record.type) && !KNOWN_IGNORED_TYPES.has(record.type)) {
      unknownCount++;
    }
    parsed.push({ record, line: lineNumber });
  }

  if (oversizedLines > 0) {
    preDiagnostics.push({
      kind: 'diagnostic',
      level: 'warn',
      code: 'oversized-line',
      message: `${oversizedLines} line(s) exceeded the size cap and were skipped`,
    });
  }

  const hasTurnDuration = parsed.some(
    (p) => p.record.type === 'system' && p.record.subtype === 'turn_duration',
  );
  const initialCwd = parsed.find((p) => p.record.cwd)?.record.cwd;
  const initialVersion = parsed.find((p) => p.record.version)?.record.version;
  const initialBranch = parsed.find((p) => p.record.gitBranch)?.record.gitBranch;
  const initialAt = parsed.find((p) => p.record.timestamp)?.record.timestamp;
  const lastAiTitleRecord = [...parsed].reverse().find((p) => p.record.type === 'ai-title');
  const title = lastAiTitleRecord?.record.aiTitle;
  const sawUnexpectedSidechain =
    ref.kind === 'root' && parsed.some((p) => p.record.isSidechain === true);

  // `entrypoint` is a session-wide fact repeated on most records; the first
  // observed value is the session's surface. The dispatch marker can appear
  // anywhere in the file, so both need the same whole-file pre-pass the
  // `meta` event already requires.
  const entrypoint = parsed.find((p) => p.record.entrypoint)?.record.entrypoint;
  const dispatched = parsed.some((p) => p.record.type === DISPATCH_MARKER_TYPE);

  yield {
    kind: 'meta',
    sourceId: ref.sourceId,
    role: ref.kind,
    harnessVersion: initialVersion,
    cwd: initialCwd,
    title,
    git: initialBranch ? { branch: initialBranch } : undefined,
    at: initialAt,
  };

  const initiator = classifyInitiator({ entrypoint, dispatched });
  if (initiator) {
    yield {
      kind: 'initiator',
      initiatorKind: initiator.kind,
      surface: initiator.surface,
      automation: initiator.automation,
      confidence: initiator.confidence,
    };
  }

  for (const d of preDiagnostics) yield d;

  if (truncated) {
    yield {
      kind: 'diagnostic',
      level: 'info',
      code: 'source-truncated',
      message: 'The final line had no trailing newline; the source may be incomplete',
    };
  }
  if (sawUnexpectedSidechain) {
    yield {
      kind: 'diagnostic',
      level: 'warn',
      code: 'unexpected-sidechain',
      message: 'A root source contained isSidechain:true records',
    };
  }

  if (ref.kind === 'child' && ref.parentHint) {
    const metaPath = join(dirname(ref.path), `${basename(ref.path, '.jsonl')}.meta.json`);
    const metaRaw = await ctx.fs.readFile(metaPath);
    if (metaRaw) {
      try {
        const meta = parseMetaJson(JSON.parse(metaRaw));
        if (meta) {
          yield {
            kind: 'link',
            parentSourceId: ref.parentHint,
            relation: 'subagent',
            agentType: meta.agentType,
            depth: meta.spawnDepth,
            viaCallId: meta.toolUseId,
          };
        }
      } catch {
        yield {
          kind: 'diagnostic',
          level: 'warn',
          code: 'invalid-agent-meta',
          message: 'Could not parse the subagent .meta.json file',
        };
      }
    } else {
      yield {
        kind: 'diagnostic',
        level: 'warn',
        code: 'missing-agent-meta',
        message: 'A child source has no matching .meta.json file',
      };
    }
  }

  let lastCwd = initialCwd;
  let lastVersion = initialVersion;

  for (const { record } of parsed) {
    if (record.cwd && record.cwd !== lastCwd) {
      yield { kind: 'cwd', cwd: record.cwd, at: record.timestamp };
      lastCwd = record.cwd;
    }
    if (record.version && record.version !== lastVersion) {
      yield { kind: 'version', version: record.version, at: record.timestamp };
      lastVersion = record.version;
    }

    switch (record.type) {
      case 'assistant':
        yield* handleAssistant(record);
        break;
      case 'user':
        yield* handleUser(record, hasTurnDuration);
        break;
      case 'system':
        yield* handleSystem(record);
        break;
      case 'permission-mode':
        if (record.permissionMode)
          yield { kind: 'mode', mode: record.permissionMode, at: record.timestamp };
        break;
      case 'cost-state':
        if (record.totalCostUSD !== undefined)
          yield { kind: 'cost', usd: record.totalCostUSD, at: record.timestamp };
        break;
      case 'ai-title':
        break; // handled up front for the meta event
      case 'attachment':
        yield* handleAttachment(record);
        break;
      default:
        break; // unknown/known-ignored types contribute nothing per-record
    }
  }

  if (unknownCount > 0) {
    yield {
      kind: 'diagnostic',
      level: 'info',
      code: 'unknown-record-type',
      message: `Saw ${unknownCount} record(s) of an unrecognized type`,
      count: unknownCount,
    };
  }
}

function* handleAssistant(record: ClaudeCodeRecord): Generator<ScoutEvent> {
  const message = record.message;
  const model = message?.model;
  const isSynthetic = model === '<synthetic>';

  if (record.timestamp) yield { kind: 'observed', at: record.timestamp };
  if (model && !isSynthetic) yield { kind: 'model', model, at: record.timestamp };
  if (record.effort) yield { kind: 'effort', effort: record.effort, at: record.timestamp };

  const usage = message?.usage;
  if (usage) {
    const blocks = { text: 0, thinking: 0, toolUse: 0 };
    for (const block of message?.content ?? []) {
      if (block.type === 'text') blocks.text++;
      else if (block.type === 'thinking') blocks.thinking++;
      else if (block.type === 'tool_use') blocks.toolUse++;
    }
    yield {
      kind: 'usage',
      dedupeKey: record.requestId,
      model: isSynthetic ? undefined : model,
      at: record.timestamp,
      uncachedInput: usage.input_tokens,
      cachedInput: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      output: usage.output_tokens,
      reasoningOutput: usage.output_tokens_details?.thinking_tokens,
      blocks,
    };
  }

  for (const block of message?.content ?? []) {
    if (block.type === 'tool_use' && block.name) {
      yield {
        kind: 'toolCall',
        at: record.timestamp,
        name: block.name,
        category: claudeCodeToolCategory(block.name),
        callId: block.id,
      };
    }
  }
}

function* handleUser(record: ClaudeCodeRecord, hasTurnDuration: boolean): Generator<ScoutEvent> {
  if (record.timestamp) yield { kind: 'observed', at: record.timestamp };

  const content = record.message?.content ?? [];
  const toolResults = content.filter((b) => b.type === 'tool_result');
  for (const block of toolResults) {
    yield {
      kind: 'toolResult',
      at: record.timestamp,
      callId: block.tool_use_id,
      error: block.is_error === true,
    };
  }

  if (!hasTurnDuration && !record.isMeta && toolResults.length === 0) {
    yield { kind: 'turn', at: record.timestamp };
  }
}

function* handleSystem(record: ClaudeCodeRecord): Generator<ScoutEvent> {
  if (record.subtype === 'compact_boundary') {
    yield {
      kind: 'compaction',
      at: record.timestamp,
      trigger: record.compactMetadata?.trigger,
      preTokens: record.compactMetadata?.preTokens,
      postTokens: record.compactMetadata?.postTokens,
    };
    return;
  }
  if (record.subtype === 'turn_duration') {
    yield { kind: 'turn', at: record.timestamp, durationMs: record.durationMs };
    return;
  }
  if (record.timestamp) yield { kind: 'observed', at: record.timestamp };
}

function* handleAttachment(record: ClaudeCodeRecord): Generator<ScoutEvent> {
  const type = record.attachment?.type;
  if (type === 'hook_success' || type === 'hook_system_message') {
    const name = hookEventName(record.attachment?.hookName);
    if (name) yield { kind: 'harnessEvent', at: record.timestamp, name };
    return;
  }
  if (type === 'command_permissions') {
    yield { kind: 'harnessEvent', at: record.timestamp, name: 'permission' };
    return;
  }
  if (type === 'plan_mode') {
    yield { kind: 'harnessEvent', at: record.timestamp, name: 'plan-mode' };
    return;
  }
  if (type === 'plan_mode_exit') {
    yield { kind: 'harnessEvent', at: record.timestamp, name: 'plan-mode-exit' };
    return;
  }
  if (type === 'auto_mode') {
    yield { kind: 'harnessEvent', at: record.timestamp, name: 'auto-mode' };
  }
  // total_tokens_reminder, file, edited_text_file, *_delta, etc.: ignored.
}
