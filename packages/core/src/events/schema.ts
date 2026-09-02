import { z } from 'zod';
import { ToolCategorySchema } from '../model/schema';

const usageFields = {
  uncachedInput: z.number().finite().min(0).optional(),
  cachedInput: z.number().finite().min(0).optional(),
  cacheWrite: z.number().finite().min(0).optional(),
  output: z.number().finite().min(0).optional(),
  reasoningOutput: z.number().finite().min(0).optional(),
};

const usageFieldKeySchema = z.enum([
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
]);

// Plain union, not discriminatedUnion: the two 'flag' variants share the
// literal kind:'flag' and differ on a nested discriminant instead, which
// z.discriminatedUnion cannot key on directly.
export const ScoutEventSchema = z.union([
  z.object({
    kind: z.literal('meta'),
    sourceId: z.string().min(1),
    role: z.enum(['root', 'child']),
    harnessVersion: z.string().optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    git: z
      .object({
        branch: z.string().optional(),
        commit: z.string().optional(),
        remote: z.string().optional(),
      })
      .optional(),
    at: z.string().optional(),
  }),
  z.object({
    kind: z.literal('link'),
    parentSourceId: z.string().min(1),
    relation: z.enum(['subagent', 'teammate', 'fork']),
    agentType: z.string().optional(),
    depth: z.number().int().min(0).optional(),
    viaCallId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('initiator'),
    initiatorKind: z.enum(['human', 'machine', 'unknown']),
    surface: z.string().min(1),
    automation: z.string().min(1).optional(),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  z.object({ kind: z.literal('observed'), at: z.string() }),
  z.object({ kind: z.literal('model'), model: z.string().min(1), at: z.string().optional() }),
  z.object({ kind: z.literal('mode'), mode: z.string().min(1), at: z.string().optional() }),
  z.object({ kind: z.literal('effort'), effort: z.string().min(1), at: z.string().optional() }),
  z.object({ kind: z.literal('cwd'), cwd: z.string().min(1), at: z.string().optional() }),
  z.object({ kind: z.literal('version'), version: z.string().min(1), at: z.string().optional() }),
  z.object({
    kind: z.literal('usage'),
    dedupeKey: z.string().optional(),
    model: z.string().optional(),
    at: z.string().optional(),
    ...usageFields,
    derived: z.array(usageFieldKeySchema).optional(),
    blocks: z
      .object({
        text: z.number().int().min(0).optional(),
        thinking: z.number().int().min(0).optional(),
        toolUse: z.number().int().min(0).optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('usageTotal'),
    at: z.string().optional(),
    ...usageFields,
    derived: z.array(usageFieldKeySchema).optional(),
  }),
  z.object({
    kind: z.literal('turn'),
    at: z.string().optional(),
    durationMs: z.number().min(0).optional(),
  }),
  z.object({
    kind: z.literal('toolCall'),
    at: z.string().optional(),
    name: z.string().min(1),
    category: ToolCategorySchema,
    callId: z.string().optional(),
    durationMs: z.number().min(0).optional(),
  }),
  z.object({
    kind: z.literal('toolResult'),
    at: z.string().optional(),
    callId: z.string().optional(),
    name: z.string().optional(),
    error: z.boolean(),
    durationMs: z.number().min(0).optional(),
  }),
  z.object({ kind: z.literal('harnessEvent'), at: z.string().optional(), name: z.string().min(1) }),
  z.object({
    kind: z.literal('compaction'),
    at: z.string().optional(),
    trigger: z.string().optional(),
    preTokens: z.number().min(0).optional(),
    postTokens: z.number().min(0).optional(),
  }),
  z.object({ kind: z.literal('cost'), usd: z.number().min(0), at: z.string().optional() }),
  z.object({ kind: z.literal('flag'), flag: z.literal('resumed'), value: z.literal(true) }),
  z.object({ kind: z.literal('flag'), flag: z.literal('forkedFrom'), value: z.string() }),
  z.object({
    kind: z.literal('diagnostic'),
    level: z.enum(['info', 'warn', 'error']),
    code: z.string(),
    message: z.string().max(200),
    line: z.number().int().optional(),
    count: z.number().int().min(0).optional(),
  }),
]);
