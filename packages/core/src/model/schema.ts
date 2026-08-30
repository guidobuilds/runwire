import { z } from 'zod';
import { KNOWN_HARNESS_IDS } from './harness';

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export function metricSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.object({
    value: inner,
    confidence: ConfidenceSchema,
    source: z.string(),
    note: z.string().optional(),
  });
}

/** Permissive at the JSON boundary: any string, not the closed TS union (docs/ARCHITECTURE.md §2.3). */
export const HarnessIdSchema = z.string().min(1);

export const UsageSchema = z.object({
  uncachedInput: metricSchema(z.number()).optional(),
  cachedInput: metricSchema(z.number()).optional(),
  cacheWrite: metricSchema(z.number()).optional(),
  output: metricSchema(z.number()).optional(),
  reasoningOutput: metricSchema(z.number()).optional(),
  totalInput: metricSchema(z.number()).optional(),
});

export const CountsSchema = z.object({
  turns: metricSchema(z.number()).optional(),
  apiCalls: metricSchema(z.number()).optional(),
  toolCalls: metricSchema(z.number()).optional(),
  compactions: metricSchema(z.number()).optional(),
  subagents: metricSchema(z.number()).optional(),
});

export const DiagnosticSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  message: z.string().max(200),
  harness: HarnessIdSchema,
  path: z.string(),
  line: z.number().int().optional(),
  count: z.number().int().optional(),
});

export const ProjectRefSchema = z.object({
  key: z.string(),
  name: z.string(),
  repoRoot: z.string().optional(),
  worktree: z.string().optional(),
  identity: z.enum(['remote', 'repo-root', 'cwd']),
});

export const SessionSummarySchema = z.object({
  id: z.string(),
  harness: HarnessIdSchema,
  harnessVersion: z.object({ first: z.string(), last: z.string() }).optional(),
  parentId: z.string().optional(),
  relation: z.enum(['subagent', 'teammate', 'fork']).optional(),
  depth: z.number().int().min(0),
  agentType: z.string().optional(),
  title: z.object({ value: z.string(), contentDerived: z.literal(true) }).optional(),
  project: ProjectRefSchema,
  cwd: z.object({ first: z.string(), all: z.array(z.string()) }),
  git: z
    .object({
      branch: z.string().optional(),
      commit: z.string().optional(),
      repoName: z.string().optional(),
    })
    .optional(),
  timing: z.object({
    startedAt: metricSchema(z.string()).optional(),
    endedAt: metricSchema(z.string()).optional(),
    durationMs: metricSchema(z.number()).optional(),
  }),
  model: z.object({
    primary: metricSchema(z.string()).optional(),
    all: z.array(z.string()),
    changes: z.number().int().min(0),
  }),
  mode: z
    .object({
      primary: metricSchema(z.string()).optional(),
      all: z.array(z.string()),
      changes: z.number().int().min(0),
    })
    .optional(),
  effort: metricSchema(z.string()).optional(),
  flags: z.object({
    resumed: z.boolean().optional(),
    forkedFrom: z.string().optional(),
    versionChanged: z.boolean().optional(),
  }),
  usage: UsageSchema,
  counts: CountsSchema,
  cost: metricSchema(z.object({ usd: z.number() })).optional(),
  children: z.array(z.string()),
  source: z.object({ path: z.string(), sizeBytes: z.number().int().min(0), mtimeMs: z.number() }),
  diagnostics: z.array(DiagnosticSchema),
});

export const SessionRollupSchema = z.object({
  id: z.string(),
  exclusive: z.object({ usage: UsageSchema, counts: CountsSchema }),
  inclusive: z.object({
    usage: UsageSchema,
    counts: CountsSchema.extend({ subagents: metricSchema(z.number()) }),
  }),
  descendants: z.number().int().min(0),
});

export const ProjectAggregateSchema = z.object({
  project: ProjectRefSchema,
  sessionCount: z.number().int().min(0),
  harnesses: z.array(HarnessIdSchema),
  latestActivityAt: z.string().optional(),
  aggregateUsage: UsageSchema,
});

export const HarnessAggregateSchema = z.object({
  harness: HarnessIdSchema,
  sessionCount: z.number().int().min(0),
  projects: z.array(z.string()),
  latestActivityAt: z.string().optional(),
  aggregateUsage: UsageSchema,
});

export const ToolCategorySchema = z.enum([
  'read',
  'write',
  'exec',
  'search',
  'plan',
  'agent',
  'web',
  'mcp',
  'other',
]);

const UsageNumbersSchema = z.object({
  uncachedInput: z.number(),
  cachedInput: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  reasoningOutput: z.number(),
});

export const TraceStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call'),
    i: z.number().int(),
    at: z.string().optional(),
    model: z.string(),
    usage: UsageNumbersSchema.partial().optional(),
    cum: UsageNumbersSchema,
    blocks: z.object({
      text: z.number().int(),
      thinking: z.number().int(),
      toolUse: z.number().int(),
    }),
  }),
  z.object({
    kind: z.literal('tool'),
    i: z.number().int(),
    at: z.string().optional(),
    category: ToolCategorySchema,
    name: z.string(),
    callId: z.string().optional(),
    durationMs: z.number().optional(),
    error: z.boolean().optional(),
    childId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('turn'),
    i: z.number().int(),
    at: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    kind: z.literal('harness'),
    i: z.number().int(),
    at: z.string().optional(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('compaction'),
    i: z.number().int(),
    at: z.string().optional(),
    preTokens: z.number().optional(),
    postTokens: z.number().optional(),
  }),
  z.object({
    kind: z.literal('model-change'),
    i: z.number().int(),
    at: z.string().optional(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    kind: z.literal('mode-change'),
    i: z.number().int(),
    at: z.string().optional(),
    from: z.string().optional(),
    to: z.string(),
  }),
]);

export const SessionTraceSchema = z.object({
  id: z.string(),
  steps: z.array(TraceStepSchema),
  models: z.array(z.string()),
  axis: z.object({
    steps: z.number().int(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
  }),
  totals: UsageNumbersSchema,
  truncated: z.boolean().optional(),
});

/** Sanity check that the permissive HarnessIdSchema still accepts every known id. */
export function assertKnownHarnessIdsValidate(): void {
  for (const id of KNOWN_HARNESS_IDS) HarnessIdSchema.parse(id);
}
