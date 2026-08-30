import { adapterContract } from './contract';
import { createFakeAdapter } from './fake-adapter';

// canarySourceId is intentionally omitted: the fake adapter authors
// ScoutEvents directly and never parses a raw record through a projection
// allowlist, so there is no content-leak path for the canary check to
// exercise. It IS meaningful for real adapters (M2+), which do parse raw
// records - see docs/ARCHITECTURE.md §6 and adapters/claude-code.md.
adapterContract({
  adapter: createFakeAdapter(),
  malformedSourceId: 'malformed',
});
