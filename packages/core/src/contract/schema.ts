import { z } from 'zod';
import type { Diagnostic, Project, Session, SessionBundle, Step } from './types';

// Strict Zod at the bundle boundary. D21's loose/passthrough rule governs
// *raw harness records* inside an adapter (see e.g.
// packages/adapter-claude-code/src/schema.ts, which stays .passthrough()) -
// it does not apply here. A SessionBundle is the adapter's finished output;
// any unrecognized key at any level is a contract violation and must be
// loud, not silently dropped (.forge/core-adapter-reset/plan.md P5).
//
// Zod 4.5.4 spike (grill.md §5): `z.object` strips unknown keys by default
// (silent data loss); `.strict()` reports `unrecognized_keys` with a `keys`
// array of *names only* (never the offending value). schema.test.ts proves
// both halves: the default-stripping behavior on a throwaway loose schema,
// and that .strict() here catches what the default would have swallowed.

const nonNegInt = () => z.number().int().nonnegative();
const nonNegNumber = () => z.number().nonnegative();
/** No newline, <=200 chars - mirrors contract/diagnostic.ts's makeDiagnostic guard. */
const diagnosticMessage = () =>
  z
    .string()
    .max(200)
    .refine((s) => !s.includes('\n'), { message: 'must not contain newlines' });

export const ProjectSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    repoRoot: z.string().optional(),
    worktree: z.string().optional(),
    identity: z.enum(['remote', 'repo-root', 'cwd']),
  })
  .strict() satisfies z.ZodType<Project>;

export const SessionSchema = z
  .object({
    id: z.string(),
    harnessId: z.string(),
    projectKey: z.string(),
    parentId: z.string().optional(),
    relation: z.enum(['subagent', 'teammate', 'fork']).optional(),
    depth: nonNegInt(),
    agentType: z.string().optional(),
    spawnCallId: z.string().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional(),
    gitCommit: z.string().optional(),
    startedAt: z.iso.datetime().optional(),
    endedAt: z.iso.datetime().optional(),
    durationMs: nonNegInt().optional(),
    modelPrimary: z.string().optional(),
    modelPrimaryProvider: z.string().optional(),
    modelChanges: nonNegInt().optional(),
    modePrimary: z.string().optional(),
    modeChanges: nonNegInt().optional(),
    effort: z.string().optional(),
    uncachedInput: nonNegInt().optional(),
    cachedInput: nonNegInt().optional(),
    cacheWrite: nonNegInt().optional(),
    output: nonNegInt().optional(),
    reasoningOutput: nonNegInt().optional(),
    turns: nonNegInt().optional(),
    apiCalls: nonNegInt().optional(),
    toolCalls: nonNegInt().optional(),
    compactions: nonNegInt().optional(),
    costUsd: nonNegNumber().optional(),
    initiatorKind: z.enum(['human', 'machine', 'unknown']).optional(),
    initiatorSurface: z.string().optional(),
    initiatorAutomation: z.string().optional(),
    resumed: z.boolean().optional(),
    forkedFrom: z.string().optional(),
    harnessVersionFirst: z.string().optional(),
    harnessVersionLast: z.string().optional(),
    sourceId: z.string().optional(),
    sourceLocator: z.string().optional(),
    sourcePath: z.string(),
    sourceSize: nonNegInt(),
    sourceMtime: nonNegNumber(),
  })
  .strict() satisfies z.ZodType<Session>;

export const ToolCategorySchema = z.enum([
  'read',
  'write',
  'exec',
  'search',
  'plan',
  'agent',
  'web',
  'mcp',
  'skill',
  'other',
]);

export const StepSchema = z
  .object({
    sessionId: z.string(),
    seq: nonNegInt(),
    at: z.iso.datetime().optional(),
    kind: z.enum(['call', 'tool', 'turn', 'harness', 'compaction', 'model-change', 'mode-change']),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    toolCategory: ToolCategorySchema.optional(),
    toolName: z.string().optional(),
    // A proven identity is never empty and always a pair (see superRefine).
    mcpServer: z.string().min(1).optional(),
    mcpTool: z.string().min(1).optional(),
    callId: z.string().optional(),
    skillName: z.string().optional(),
    childId: z.string().optional(),
    durationMs: nonNegInt().optional(),
    error: z.boolean().optional(),
    uncachedInput: nonNegInt().optional(),
    cachedInput: nonNegInt().optional(),
    cacheWrite: nonNegInt().optional(),
    output: nonNegInt().optional(),
    reasoningOutput: nonNegInt().optional(),
    compactionTrigger: z.string().optional(),
    preTokens: nonNegInt().optional(),
    postTokens: nonNegInt().optional(),
    fromValue: z.string().optional(),
    toValue: z.string().optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    // MCP identity is a two-part, tool-only invariant. A malformed or
    // ambiguous name legitimately carries NEITHER field, so absence is valid;
    // only a partially/incorrectly populated pair is a contract violation.
    const hasServer = step.mcpServer !== undefined;
    const hasTool = step.mcpTool !== undefined;
    if (!hasServer && !hasTool) return;
    if (hasServer !== hasTool) {
      ctx.addIssue({
        code: 'custom',
        path: ['mcpServer'],
        message: 'mcpServer and mcpTool must both be present',
      });
      return;
    }
    if (step.kind !== 'tool' || step.toolCategory !== 'mcp') {
      ctx.addIssue({
        code: 'custom',
        path: ['mcpServer'],
        message: 'MCP identity is only valid on a tool step of category mcp',
      });
    }
  }) satisfies z.ZodType<Step>;

export const DiagnosticSchema = z
  .object({
    level: z.enum(['info', 'warn', 'error']),
    code: z.string(),
    message: diagnosticMessage(),
    line: nonNegInt().optional(),
    count: nonNegInt().optional(),
  })
  .strict() satisfies z.ZodType<Diagnostic>;

export const SessionBundleSchema = z
  .object({
    project: ProjectSchema,
    session: SessionSchema,
    steps: z.array(StepSchema),
    diagnostics: z.array(DiagnosticSchema),
  })
  .strict() satisfies z.ZodType<SessionBundle>;

export type ValidateBundleResult =
  | { ok: true; bundle: SessionBundle }
  | { ok: false; issues: string[] };

/**
 * `path: code`; `unrecognized_keys` issues append the offending key *names*
 * (never a value) in parentheses. No issue string can ever contain record
 * content: we build the string from `issue.path`/`issue.code`/`issue.keys`
 * only, never from `issue.message` (which for some issue kinds can quote a
 * received value) or from the input itself.
 */
function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.join('.');
  const base = `${path}: ${issue.code}`;
  if (issue.code === 'unrecognized_keys') {
    return `${base} (${issue.keys.join(', ')})`;
  }
  return base;
}

export function validateBundle(input: unknown): ValidateBundleResult {
  const result = SessionBundleSchema.safeParse(input);
  if (result.success) {
    return { ok: true, bundle: result.data };
  }
  return { ok: false, issues: result.error.issues.map(formatIssue) };
}
