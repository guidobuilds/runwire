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
      to: { path: '^(packages/(adapter-|server|web)|apps/)' },
    },
    {
      name: 'adapter-imports-core-only',
      comment:
        'An adapter package may only import @scout/core (this also forbids importing another adapter).',
      severity: 'error',
      from: { path: '^packages/adapter-' },
      to: { path: '^packages/(?!core)' },
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
