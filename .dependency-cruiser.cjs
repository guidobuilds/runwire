// Enforces the workspace import boundaries in docs/ARCHITECTURE.md §1.
// Adding a harness adapter (packages/adapter-<id>) needs no change here:
// the "adapter-core-only" rule already covers it (anything that isn't
// packages/core is forbidden), which also blocks adapter-to-adapter imports.
//
// Known limitation: pure `import type { ... }` declarations produce no
// runtime import and are invisible to this graph (verified empirically —
// packages/web's type-only import of @scout/core is not reported as an
// edge at all). This only weakens the "web imports core *types only*"
// guidance, not enforcement: any forbidden *runtime* import (the actual
// privacy/data-flow risk) is a normal import and is still caught.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-standalone',
      comment: 'packages/core must not import from any other workspace package.',
      severity: 'error',
      from: { path: '^packages/core' },
      to: { path: '^packages/(?!core)' },
    },
    {
      name: 'adapter-imports-core-only',
      comment:
        'An adapter package may only import @scout/core and its own files (this also forbids ' +
        'importing another adapter or packages/cli). The `$1` back-reference in `to.pathNot` ' +
        "self-exempts each adapter's own intra-package imports from the rule that matches " +
        '`^packages/(?!core)` — without it, every import an adapter makes of its own sibling ' +
        'files (e.g. index.ts → parse.ts) is a false-positive violation of this rule.',
      severity: 'error',
      from: { path: '^packages/(adapter-[^/]+)/' },
      to: { path: '^packages/(?!core)', pathNot: '^packages/$1/' },
    },
    {
      name: 'cli-imports-core-and-adapters',
      comment:
        'packages/cli is the composition root (D76): it may import @scout/core and any ' +
        "adapter-* package, plus its own files. The `|cli` alternative in `to.path`'s negative " +
        "lookahead self-exempts the cli's own intra-package imports (e.g. index.ts → " +
        'commands/import.ts) - without it, every import the cli makes of its own sibling files ' +
        'is a false-positive violation, the same bug adapter-imports-core-only had before its ' +
        'own self-exemption.',
      severity: 'error',
      from: { path: '^packages/cli/' },
      to: { path: '^packages/(?!core|adapter-|cli)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Build output is not source: from M4 on, `packages/web/dist` holds bundled
    // JS that would otherwise be cruised after `bun run build` (7 extra
    // "modules" and pointless work). dependency-cruiser does not read
    // .gitignore, so it has to be excluded explicitly.
    exclude: { path: ['\\.test\\.tsx?$', '(^|/)dist/'] },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], mainFields: ['main'] },
  },
};
