import type { SessionSummary } from './session';

/**
 * True when the harness told us a *machine* started this session.
 *
 * Deliberately asymmetric with `kind === 'human'`: `unknown` (an `entrypoint`
 * value this adapter version does not recognise) and absent (a session recorded
 * before the harness emitted the signal at all) both answer **false**, so the
 * only sessions this hides are the ones we positively know are machine-started.
 * A new harness surface, or an older session, degrades towards being *shown* —
 * the failure mode of a filter that hides real work is much worse than the
 * failure mode of one that leaves some noise on screen.
 *
 * This is the single predicate behind every "automated" filter in the product
 * (see `ScoutStore.getRoots`); nothing downstream re-derives it from
 * `surface`/`automation` strings.
 */
export function isMachineInitiated(summary: SessionSummary): boolean {
  return summary.initiator?.value.kind === 'machine';
}
