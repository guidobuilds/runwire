import { z } from 'zod';

const sessionRowSchema = z
  .object({
    id: z.string().optional(),
    project_id: z.string().optional(),
    parent_id: z.string().nullable().optional(),
    fork_session_id: z.string().nullable().optional(),
    directory: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    agent: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    time_created: z.number().nullable().optional(),
    time_updated: z.number().nullable().optional(),
    time_suspended: z.number().nullable().optional(),
    tokens_input: z.number().nullable().optional(),
    tokens_output: z.number().nullable().optional(),
    tokens_reasoning: z.number().nullable().optional(),
    tokens_cache_read: z.number().nullable().optional(),
    tokens_cache_write: z.number().nullable().optional(),
  })
  .passthrough();

export type OpenCodeSessionRow = z.infer<typeof sessionRowSchema>;

export function parseSessionRow(raw: unknown): OpenCodeSessionRow | undefined {
  const result = sessionRowSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

const messageSchema = z
  .object({
    type: z.string().optional(),
    role: z.string().optional(),
    model: z
      .object({ id: z.string().optional(), providerID: z.string().optional() })
      .passthrough()
      .optional(),
    previous: z.object({ id: z.string().optional() }).passthrough().optional(),
    time: z
      .object({
        created: z.number().optional(),
        completed: z.number().optional(),
        streamed: z.number().optional(),
      })
      .passthrough()
      .optional(),
    tokens: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        reasoning: z.number().optional(),
        cache: z
          .object({ read: z.number().optional(), write: z.number().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    content: z
      .array(
        z
          .object({
            type: z.string().optional(),
            id: z.string().optional(),
            name: z.string().optional(),
            tool: z.string().optional(),
            time: z
              .object({ created: z.number().optional(), completed: z.number().optional() })
              .passthrough()
              .optional(),
            state: z
              .object({
                status: z.string().optional(),
                metadata: z.object({ sessionID: z.string().optional() }).passthrough().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export type OpenCodeMessageData = z.infer<typeof messageSchema>;

export function parseMessageData(raw: unknown): OpenCodeMessageData | undefined {
  const result = messageSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
