import type { Capability } from '../api/types';

/**
 * Every displayed field, as a runtime list. `FieldKey` is derived from it, so a
 * field cannot enter the union without also entering this array — which is what
 * lets `MetricCell.test.tsx`'s "no field ever renders a stringified object"
 * guard loop the **whole field union** rather than a hand-kept copy of it.
 *
 * That closes the field axis only. The guard runs each field against a list of
 * sampled value shapes, so a leak scoped to a shape the list does not
 * instantiate still ships green (BL-15) — do not read this array as making the
 * guard exhaustive.
 */
export const ALL_FIELD_KEYS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
  'turns',
  'apiCalls',
  'toolCalls',
  'compactions',
  'subagents',
  'startedAt',
  'endedAt',
  'durationMs',
  'model',
  'mode',
  'effort',
  'cost',
  'harnessVersion',
  'title',
  'git',
] as const;

export type FieldKey = (typeof ALL_FIELD_KEYS)[number];

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
