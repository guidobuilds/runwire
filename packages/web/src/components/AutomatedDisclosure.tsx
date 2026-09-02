/**
 * What the "Automated" preference took out of a *grouped* view (the Projects
 * and Harnesses grids).
 *
 * The session tables already disclose their own filtering inline in
 * `SessionFilters` ("65 sessions · 318 automated hidden"). A grid cannot reuse
 * that string, because the two screens hide different **things**: a grid loses
 * whole cards, and the number the server reports for hidden *sessions* is not
 * the number of cards that disappeared. On real data `/projects` drops 184 of
 * 204 cards while 318 root sessions go uncounted — writing "184 sessions
 * hidden" over a projects grid would be false, and writing "318 projects
 * hidden" would be worse.
 *
 * So this renders the two counts as two clauses, each naming its own unit:
 *
 *     184 of 204 projects hidden · 318 automated sessions not counted
 *
 * The second clause is what makes the remaining cards' `sessionCount` and
 * usage totals honest — hidden means it counts nowhere (the approved model),
 * so every total on screen is missing exactly those sessions.
 *
 * Deliberately says nothing about cost, spend or savings: the hidden rows are
 * ~83% of the sessions but only a couple of percent of the token mass, so any
 * copy implying this reveals real spend would be false. Pinned by a test.
 */
export type AutomatedDisclosureProps = {
  /** Cards on screen right now. Only used to give the hidden count a denominator. */
  visibleGroups: number;
  /** Cards that vanished entirely because every session in them was machine-started. */
  hiddenGroups: number;
  /** Root sessions the filter removed from every total on this screen. */
  hiddenAutomated: number;
  /** The unit of a card, singular and plural — `project`/`projects`. */
  groupNoun: readonly [singular: string, plural: string];
};

function count(n: number, [singular, plural]: readonly [string, string]): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function AutomatedDisclosure({
  visibleGroups,
  hiddenGroups,
  hiddenAutomated,
  groupNoun,
}: AutomatedDisclosureProps) {
  if (hiddenGroups <= 0 && hiddenAutomated <= 0) return null;

  const clauses: string[] = [];
  if (hiddenGroups > 0) {
    clauses.push(`${hiddenGroups} of ${count(visibleGroups + hiddenGroups, groupNoun)} hidden`);
  }
  if (hiddenAutomated > 0) {
    clauses.push(
      `${count(hiddenAutomated, ['automated session', 'automated sessions'])} not counted`,
    );
  }

  return <p className="text-xs text-muted-foreground">{clauses.join(' · ')}</p>;
}
