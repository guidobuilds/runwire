Generated union of every other fixture in this directory (small, tree,
subagents, extra-usage, legacy, malformed, canary), used only so the adapter
contract kit's "capabilities are consistent with what the fixtures actually
exercise" check (packages/core/src/test-kit/contract.ts) sees the full
repertoire of real behavior in one `discover()` view — no single fixture
alone exercises every declared capability (e.g. only `extra-usage/` has a
`compaction` step; only `small/` exercises cache-write/reasoning cost; only
`canary/` carries every content hazard key).

`fork/` is deliberately EXCLUDED: the kit's `subagents` capability gate
observes the session-level `relation` field
(packages/core/src/contract/capabilities.ts), while Pi deliberately does not
declare `subagents` (D81), so a `relation: 'fork'` session inside this union
would fail the both-directions capability check. Fork coverage lives in
`fork/`'s per-case tests instead.

Regenerate by re-copying if any source fixture changes.
