import type { Session, StepKind } from './types';

/** ARCHITECTURE §3. No `trace.*` successor (dropped, plan P14). */
export type Capability =
  | 'usage.perCall'
  | 'usage.cumulative'
  | 'usage.cacheWrite'
  | 'usage.reasoning'
  | 'timing'
  | 'model'
  | 'mode'
  | 'effort'
  | 'version'
  | 'turns'
  | 'toolCalls'
  | 'compactions'
  | 'subagents'
  | 'cost'
  | 'title'
  | 'git'
  | 'initiator'
  | 'steps.errors'
  | 'steps.harness'
  | 'steps.toolDurations';

export const CAPABILITIES: readonly Capability[] = [
  'usage.perCall',
  'usage.cumulative',
  'usage.cacheWrite',
  'usage.reasoning',
  'timing',
  'model',
  'mode',
  'effort',
  'version',
  'turns',
  'toolCalls',
  'compactions',
  'subagents',
  'cost',
  'title',
  'git',
  'initiator',
  'steps.errors',
  'steps.harness',
  'steps.toolDurations',
];

/**
 * A single step field is identified as `${kind}.${field}` so the same field
 * name on two different step kinds (e.g. `fromValue` on both `model-change`
 * and `mode-change`) can be gated by two different capabilities without
 * colliding.
 */
export type StepFieldKey = `${StepKind}.${string}`;

export type CapabilityGate = {
  /** Session fields this capability is responsible for. */
  sessionFields: readonly (keyof Session)[];
  /** Step kinds this capability introduces (each StepKind is owned by exactly one capability). */
  stepKinds: readonly StepKind[];
  /** Step fields (as `kind.field`) this capability is responsible for. */
  stepFields: readonly StepFieldKey[];
};

/**
 * Maps every capability to the session fields, step kinds and step fields it
 * gates, both directions checked by capabilities.test.ts: every Capability
 * has an entry (enforced by the Record type + a runtime key-count check),
 * and every gated field/kind appears in exactly one entry (runtime check,
 * since two capabilities could otherwise both claim the same field).
 */
export const CAPABILITY_FIELDS: Record<Capability, CapabilityGate> = {
  'usage.perCall': {
    sessionFields: [],
    stepKinds: ['call'],
    stepFields: ['call.uncachedInput', 'call.cachedInput', 'call.output'],
  },
  'usage.cumulative': {
    sessionFields: ['uncachedInput', 'cachedInput', 'output'],
    stepKinds: [],
    stepFields: [],
  },
  'usage.cacheWrite': {
    sessionFields: ['cacheWrite'],
    stepKinds: [],
    stepFields: ['call.cacheWrite'],
  },
  'usage.reasoning': {
    sessionFields: ['reasoningOutput'],
    stepKinds: [],
    stepFields: ['call.reasoningOutput'],
  },
  timing: {
    sessionFields: ['startedAt', 'endedAt', 'durationMs'],
    stepKinds: [],
    stepFields: [
      'call.at',
      'tool.at',
      'turn.at',
      'turn.durationMs',
      'harness.at',
      'compaction.at',
      'model-change.at',
      'mode-change.at',
    ],
  },
  model: {
    sessionFields: ['modelPrimary', 'modelChanges'],
    stepKinds: ['model-change'],
    stepFields: ['call.model', 'model-change.fromValue', 'model-change.toValue'],
  },
  mode: {
    sessionFields: ['modePrimary', 'modeChanges'],
    stepKinds: ['mode-change'],
    stepFields: ['mode-change.fromValue', 'mode-change.toValue'],
  },
  effort: { sessionFields: ['effort'], stepKinds: [], stepFields: [] },
  version: {
    sessionFields: ['harnessVersionFirst', 'harnessVersionLast'],
    stepKinds: [],
    stepFields: [],
  },
  turns: { sessionFields: ['turns'], stepKinds: ['turn'], stepFields: [] },
  toolCalls: {
    sessionFields: ['toolCalls'],
    stepKinds: ['tool'],
    stepFields: ['tool.toolCategory', 'tool.toolName', 'tool.callId', 'tool.skillName'],
  },
  compactions: {
    sessionFields: ['compactions'],
    stepKinds: ['compaction'],
    stepFields: ['compaction.compactionTrigger', 'compaction.preTokens', 'compaction.postTokens'],
  },
  // `tool.childId` is deliberately NOT gated here: it is filled by core at
  // link time, never emitted by an adapter, so it can
  // never be "observed" straight from a bundle stream. What an adapter
  // itself emits to say "I model subagents" is the session-level linkage
  // fields on a child (parentId/relation/agentType/spawnCallId).
  subagents: {
    sessionFields: ['parentId', 'relation', 'agentType', 'spawnCallId'],
    stepKinds: [],
    stepFields: [],
  },
  cost: { sessionFields: ['costUsd'], stepKinds: [], stepFields: [] },
  title: { sessionFields: ['title'], stepKinds: [], stepFields: [] },
  git: { sessionFields: ['gitBranch', 'gitCommit'], stepKinds: [], stepFields: [] },
  initiator: {
    sessionFields: ['initiatorKind', 'initiatorSurface', 'initiatorAutomation'],
    stepKinds: [],
    stepFields: [],
  },
  'steps.errors': { sessionFields: [], stepKinds: [], stepFields: ['tool.error'] },
  'steps.harness': {
    sessionFields: [],
    stepKinds: ['harness'],
    stepFields: ['harness.toolName'],
  },
  'steps.toolDurations': { sessionFields: [], stepKinds: [], stepFields: ['tool.durationMs'] },
};
