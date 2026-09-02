import { z } from 'zod';

/**
 * Validates the record AFTER it has already been passed through
 * `project(record, claudeCodeAllowlist)` — every field is optional and
 * loosely typed (docs/DECISIONS.md D21: loose schemas, version-gated field
 * maps, not one adapter per version). `.passthrough()` on every object so an
 * allowlisted-but-unmodeled field never fails validation.
 */
const contentBlockSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
    id: z.string().optional(),
    tool_use_id: z.string().optional(),
    is_error: z.boolean().optional(),
  })
  .passthrough();

const usageSchema = z
  .object({
    input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    output_tokens_details: z
      .object({ thinking_tokens: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.string().optional(),
    model: z.string().optional(),
    stop_reason: z.string().nullable().optional(),
    usage: usageSchema.optional(),
    content: z.array(contentBlockSchema).optional(),
  })
  .passthrough();

const compactMetadataSchema = z
  .object({
    trigger: z.string().optional(),
    preTokens: z.number().optional(),
    postTokens: z.number().optional(),
  })
  .passthrough();

const attachmentSchema = z
  .object({
    type: z.string().optional(),
    hookName: z.string().optional(),
  })
  .passthrough();

export const claudeCodeRecordSchema = z
  .object({
    type: z.string().optional(),
    subtype: z.string().optional(),
    uuid: z.string().optional(),
    parentUuid: z.string().nullable().optional(),
    requestId: z.string().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    version: z.string().optional(),
    gitBranch: z.string().optional(),
    isSidechain: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    isCompactSummary: z.boolean().optional(),
    agentId: z.string().nullable().optional(),
    entrypoint: z.string().optional(),
    promptSource: z.string().optional(),
    effort: z.string().optional(),
    permissionMode: z.string().optional(),
    durationMs: z.number().optional(),
    totalCostUSD: z.number().optional(),
    aiTitle: z.string().optional(),
    compactMetadata: compactMetadataSchema.optional(),
    message: messageSchema.optional(),
    attachment: attachmentSchema.optional(),
  })
  .passthrough();

export type ClaudeCodeRecord = z.infer<typeof claudeCodeRecordSchema>;

const metaJsonSchema = z
  .object({
    agentType: z.string().optional(),
    spawnDepth: z.number().optional(),
    toolUseId: z.string().optional(),
  })
  .passthrough();

export type ClaudeCodeAgentMeta = z.infer<typeof metaJsonSchema>;

export function parseMetaJson(raw: unknown): ClaudeCodeAgentMeta | undefined {
  const result = metaJsonSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
