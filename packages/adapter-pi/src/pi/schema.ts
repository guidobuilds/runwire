import { z } from 'zod';

const costSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    total: z.number().optional(),
  })
  .passthrough();

const usageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    reasoning: z.number().optional(),
    totalTokens: z.number().optional(),
    cost: costSchema.optional(),
  })
  .passthrough();

const contentBlockSchema = z
  .object({
    type: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.string().optional(),
    api: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    responseModel: z.string().optional(),
    responseId: z.string().optional(),
    providerThinkingLevel: z.string().optional(),
    thinkingLevel: z.string().optional(),
    durationMs: z.number().optional(),
    stopReason: z.string().nullable().optional(),
    timestamp: z.number().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
    usage: usageSchema.optional(),
    content: z.array(contentBlockSchema).optional(),
    nestedCalls: z
      .object({
        complete: z.boolean().optional(),
        calls: z
          .array(
            z
              .object({
                name: z.string().optional(),
                status: z.string().optional(),
                durationMs: z.number().optional(),
                argumentsBytes: z.number().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const piRecordSchema = z
  .object({
    type: z.string().optional(),
    version: z.number().optional(),
    id: z.string().optional(),
    parentId: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    parentSession: z.string().optional(),
    thinkingLevel: z.string().optional(),
    provider: z.string().optional(),
    modelId: z.string().optional(),
    kind: z.string().optional(),
    customType: z.string().optional(),
    tokensBefore: z.number().optional(),
    fromHook: z.boolean().optional(),
    firstKeptEntryId: z.string().optional(),
    firstKeptEntryIndex: z.number().optional(),
    retainedTail: z.array(z.object({}).passthrough()).optional(),
    usage: usageSchema.optional(),
    message: messageSchema.optional(),
  })
  .passthrough();

export type PiRecord = z.infer<typeof piRecordSchema>;
