# Fork

A parentSession header naming an imported session produces a gentle-shell fork
link without parentId. Included in the union because Gentle Shell, unlike Pi,
declares `subagents`.

The second session's parentSession names a uuid that is imported nowhere, so Pi
1.5.0 tolerance is pinned too: the session still imports as a root, with an
`unresolved-parent-session` info diagnostic and no relation. Neither header leaks
the referenced path into the bundle.
