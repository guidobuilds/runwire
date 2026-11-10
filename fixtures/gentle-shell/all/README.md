# All capabilities

Byte-for-byte union of small, subagents, published-state, unlinked, cross-home,
duplicate, extra-usage, new-format, malformed, canary and fork homes. Includes
both duplicate candidates and the Pi-owned parent (enumerated by filename, never
read).

The full contract kit requires every one of the 16 declared capabilities to be
observed, and no undeclared capability: child sessions provide subagents and
initiator; small provides cache-write/reasoning, effort and timing; extra-usage
provides compactions; new-format provides tool errors and direct durations;
canary exercises content exclusion. Parent initiators remain NULL.

The 4.x cases are in the union too: `published-state` contributes the
`gentle-agents.published-state` custom entry (only its bounded marker survives) and
the `gentle-pi.exploration-budget` custom_message (presence only), while
`subagents` contributes the receipt-linked child next to the toolResult-linked one.

From `packages/adapter-pi/src/gentle-shell`, run `UPDATE_EXPECTED=1 bun test` to
re-copy case homes and regenerate snapshots (including all/expected.json), then
`bun test` to check them without updates. This scoped command never writes Pi
snapshots. The union equality test catches stale or conflicting copied files;
remove obsolete union files deliberately if a source fixture is renamed.
