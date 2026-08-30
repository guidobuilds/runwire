/**
 * Registry-driven in spirit: this union exists for authoring adapters with
 * type safety. At the JSON boundary (Zod schemas, API responses) `harness`
 * is validated as a plain string so an unrecognized/future harness id does
 * not fail validation (see docs/ARCHITECTURE.md §2.3).
 *
 * 'fake' is reserved for packages/core/src/test-kit's adapter double; it is
 * never a real harness.
 */
export type HarnessId = 'claude-code' | 'codex' | 'grok' | 'opencode' | 'pi' | 'fake';

export const KNOWN_HARNESS_IDS: readonly HarnessId[] = [
  'claude-code',
  'codex',
  'grok',
  'opencode',
  'pi',
  'fake',
];
