import type { Capability } from '../api/types';

export type FieldKey =
  | 'uncachedInput'
  | 'cachedInput'
  | 'cacheWrite'
  | 'output'
  | 'reasoningOutput'
  | 'totalInput'
  | 'turns'
  | 'apiCalls'
  | 'toolCalls'
  | 'compactions'
  | 'subagents'
  | 'startedAt'
  | 'endedAt'
  | 'durationMs'
  | 'model'
  | 'mode'
  | 'effort'
  | 'cost'
  | 'harnessVersion'
  | 'title'
  | 'git';

export type AbsenceKind = 'not-provided' | 'missing';

/**
 * Capabilities a harness must declare for `field` to be considered provided.
 * Usage/counts cases duplicate the private map in
 * `packages/core/src/compare/comparability.ts` (do not import core runtime).
 */
export function requiredCapabilities(field: FieldKey): Capability[] {
  switch (field) {
    case 'cacheWrite':
      return ['usage.cacheWrite'];
    case 'reasoningOutput':
      return ['usage.reasoning'];
    case 'uncachedInput':
    case 'cachedInput':
    case 'output':
    case 'totalInput':
      return ['usage.perCall', 'usage.cumulative'];
    case 'apiCalls':
      return ['usage.perCall'];
    case 'turns':
      return ['turns'];
    case 'toolCalls':
      return ['toolCalls'];
    case 'compactions':
      return ['compactions'];
    case 'subagents':
      return ['subagents'];
    case 'startedAt':
    case 'endedAt':
    case 'durationMs':
      return ['timing'];
    case 'model':
      return ['model'];
    case 'mode':
      return ['mode'];
    case 'effort':
      return ['effort'];
    case 'cost':
      return ['cost'];
    case 'harnessVersion':
      return ['version'];
    case 'title':
      return ['title'];
    case 'git':
      return ['git'];
  }
}

/**
 * `not-provided` only when the adapter published a non-empty capability list
 * that shares no entry with `requiredCapabilities(field)`. Undefined, empty,
 * or overlapping lists are `missing` (including while status is still loading).
 */
export function absenceKind(
  field: FieldKey,
  capabilities: readonly Capability[] | undefined,
): AbsenceKind {
  if (capabilities === undefined || capabilities.length === 0) return 'missing';
  const needed = requiredCapabilities(field);
  const hasAny = needed.some((cap) => capabilities.includes(cap));
  return hasAny ? 'missing' : 'not-provided';
}
