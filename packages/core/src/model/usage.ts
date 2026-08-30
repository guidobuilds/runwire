import type { Metric } from './metric';

export type Usage = {
  /** Prompt tokens billed at full price. */
  uncachedInput?: Metric;
  /** Prompt tokens served from cache. */
  cachedInput?: Metric;
  /** Prompt tokens written to cache (Anthropic cache_creation; 0/absent elsewhere). */
  cacheWrite?: Metric;
  /** All generated tokens, reasoning included. */
  output?: Metric;
  /** Subset of output that is reasoning/thinking. */
  reasoningOutput?: Metric;
  /** uncachedInput + cachedInput (+ cacheWrite) - always derived, for display. */
  totalInput?: Metric;
};

export const USAGE_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
  'totalInput',
] as const satisfies readonly (keyof Usage)[];

export type Counts = {
  /** Human prompts; not rolled up. */
  turns?: Metric;
  /** Model requests. */
  apiCalls?: Metric;
  toolCalls?: Metric;
  compactions?: Metric;
  /** Descendants in the tree; rollup only. */
  subagents?: Metric;
};

export const COUNT_FIELDS = [
  'turns',
  'apiCalls',
  'toolCalls',
  'compactions',
  'subagents',
] as const satisfies readonly (keyof Counts)[];

/** Raw, unwrapped canonical usage numbers (used by the trace builder). */
export type UsageNumbers = {
  uncachedInput: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  reasoningOutput: number;
};

export const USAGE_NUMBER_FIELDS = [
  'uncachedInput',
  'cachedInput',
  'cacheWrite',
  'output',
  'reasoningOutput',
] as const satisfies readonly (keyof UsageNumbers)[];

export function zeroUsageNumbers(): UsageNumbers {
  return { uncachedInput: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 };
}
