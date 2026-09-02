import type { SessionSummary } from '../api/types';

/**
 * True when the harness told us a *machine* started this session.
 *
 * Mirrors `isMachineInitiated` in `packages/core/src/model/initiator.ts` and is
 * deliberately a copy rather than an import. `@scout/core` is a single entry
 * point that also exports the scan pipeline and the Bun filesystem adapter, so
 * importing a *runtime* value from it here would pull `node:fs`-touching module
 * graph into the browser bundle — web imports core for types only, which
 * `verbatimModuleSyntax` erases. The duplication is one comparison, and
 * `initiator.test.ts` pins it against the same table core's own test uses.
 *
 * Same asymmetry as core: `unknown` and absent both answer **false**. The only
 * sessions the product hides are the ones it positively knows are machine-
 * started; anything it cannot classify stays visible.
 *
 * This predicate is for *marking and explaining* only. It must never be used to
 * remove rows from a list — that filtering happens server-side, at
 * `ScoutStore.getRoots`, because the aggregates have to move with it. Applying
 * it inside `toSessionRows` in particular would silently delete columns from
 * Compare, whose whole input is sessions the user picked by hand.
 */
export function isMachineInitiated(summary: SessionSummary): boolean {
  return summary.initiator?.value.kind === 'machine';
}
