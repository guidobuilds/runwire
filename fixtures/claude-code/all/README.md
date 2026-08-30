Generated union of every other fixture in this directory (small, medium,
subagents, old-version, malformed, canary), used only so the adapter
contract kit's "capabilities are consistent with what the fixtures actually
exercise" check (packages/core/src/test-kit/contract.ts) sees the full
repertoire of real behavior in one `discover()` view — no single fixture
alone exercises every declared capability (e.g. only `subagents/` has a
`link` event; only `medium/` has cache-write/reasoning usage fields).
Regenerate by re-copying if any source fixture changes.
