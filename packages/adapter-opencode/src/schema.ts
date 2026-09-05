import { z } from 'zod';

/**
 * Loose, version-tolerant Zod schemas (D21: loose schemas, version-gated field
 * maps, not one adapter per version). These validate AFTER the raw record has
 * been passed through `project(record, allowlist)`, so every field is optional
 * and loosely typed. `.passthrough()` on every object so an allowlisted-but-
 * unmodeled field never fails validation. `parse*` helpers return `undefined`
 * on a bad shape and never throw.
 *
 * The `session` row (legacy V1) is a strict subset of `session_v2` (current):
 * it has no `fork_session_id`/`time_suspended`/`tokens_*`-cumulative columns,
 * so the same schema (all-optional) serves both.
 */

const sessionRowSchema = z
  .object({
    id: z.string().optional(),
    project_id: z.string().optional(),
    parent_id: z.string().nullable().optional(),
    fork_session_id: z.string().nullable().optional(),
    directory: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    agent: z.string().nullable().optional(),
    // `model` is a JSON string (e.g. `{"id":"gpt-5.6-sol",...}`) on the row.
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
    model: z.object({ id: z.string().optional() }).passthrough().optional(),
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
            tool: z.string().optional(),
            state: z.object({ status: z.string().optional() }).passthrough().optional(),
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
