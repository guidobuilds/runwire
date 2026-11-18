import type { Session, StepKind } from './types';

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

export type StepFieldKey = `${StepKind}.${string}`;

export type CapabilityGate = {
  sessionFields: readonly (keyof Session)[];
  stepKinds: readonly StepKind[];
  stepFields: readonly StepFieldKey[];
};

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
    stepFields: ['call.model', 'tool.model', 'model-change.fromValue', 'model-change.toValue'],
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
    stepFields: [
      'tool.toolCategory',
      'tool.toolName',
      'tool.callId',
      'tool.skillName',
      'tool.mcpServer',
      'tool.mcpTool',
    ],
  },
  compactions: {
    sessionFields: ['compactions'],
    stepKinds: ['compaction'],
    stepFields: ['compaction.compactionTrigger', 'compaction.preTokens', 'compaction.postTokens'],
  },
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
