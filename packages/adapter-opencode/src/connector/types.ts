import type { Diagnostic, Project, Session, Step } from '@runwire/core';
import { DiagnosticSchema, ProjectSchema, SessionSchema, StepSchema } from '@runwire/core';
import { z } from 'zod';
import type { DbOrigin } from '../paths';

export type { DbOrigin } from '../paths';

export type SourceRef = { sourceId: string; sourceLocator?: string };

export type TokenTotals = {
  uncachedInput?: number;
  cachedInput?: number;
  cacheWrite?: number;
  output?: number;
  reasoningOutput?: number;
};

export const tokenTotalsSchema = z
  .object({
    uncachedInput: z.number().nonnegative().optional(),
    cachedInput: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    reasoningOutput: z.number().nonnegative().optional(),
  })
  .strict();

/**
 * A metadata-only projection of a CORE `Session` for the inventory stream. All
 * fields are CORE `Session` fields or thin projections of them — non-sensitive,
 * CORE-representable, no content.
 */
export type SessionSummary = {
  sourceId: string;
  sourceLocator: string;
  dbOrigin: DbOrigin;
  id: string;
  projectKey: string;
  title?: string;
  agent?: string;
  modelPrimary?: string;
  parentId?: string;
  relation?: 'subagent' | 'teammate' | 'fork';
  depth: number;
  startedAt?: string;
  updatedAt?: string;
  costUsd?: number;
  tokens: TokenTotals;
  turns?: number;
  apiCalls?: number;
  toolCalls?: number;
  compactions?: number;
  resumed?: boolean;
  forkedFrom?: string;
  version?: string;
  children: string[];
};

export const sessionSummarySchema = z
  .object({
    sourceId: z.string(),
    sourceLocator: z.string(),
    dbOrigin: z.enum(['current', 'legacy']),
    id: z.string(),
    projectKey: z.string(),
    title: z.string().optional(),
    agent: z.string().optional(),
    modelPrimary: z.string().optional(),
    parentId: z.string().optional(),
    relation: z.enum(['subagent', 'teammate', 'fork']).optional(),
    depth: z.number().int().nonnegative(),
    startedAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
    costUsd: z.number().nonnegative().optional(),
    tokens: tokenTotalsSchema,
    turns: z.number().int().nonnegative().optional(),
    apiCalls: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    compactions: z.number().int().nonnegative().optional(),
    resumed: z.boolean().optional(),
    forkedFrom: z.string().optional(),
    version: z.string().optional(),
    children: z.array(z.string()),
  })
  .strict();

/**
 * The metadata-only, CORE-representable full retrieval for one session
 * (project + session + steps + diagnostics). Every field is a CORE type.
 */
export type SessionDetails = {
  harnessId: 'opencode';
  sourceId: string;
  sourceLocator: string;
  dbOrigin: DbOrigin;
  project: Project;
  session: Session;
  steps: Step[];
  diagnostics: Diagnostic[];
};

export const sessionDetailsSchema = z
  .object({
    harnessId: z.literal('opencode'),
    sourceId: z.string(),
    sourceLocator: z.string(),
    dbOrigin: z.enum(['current', 'legacy']),
    project: ProjectSchema,
    session: SessionSchema,
    steps: z.array(StepSchema),
    diagnostics: z.array(DiagnosticSchema),
  })
  .strict();
