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
        'An adapter package may only import @runwire/core and its own files (this also forbids ' +
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
        'packages/cli is the composition root (D76): it may import @runwire/core, any ' +
        'adapter-* package, @runwire/server (the transport it dispatches to), plus its own ' +
        "files. The `|server|cli` alternatives in `to.path`'s negative " +
        "lookahead self-exempt the cli's own intra-package imports (e.g. index.ts → " +
        'commands/import.ts) - without it, every import the cli makes of its own sibling files ' +
        'is a false-positive violation, the same bug adapter-imports-core-only had before its ' +
        'own self-exemption.',
      severity: 'error',
      from: { path: '^packages/cli/' },
      to: { path: '^packages/(?!core|adapter-|server|cli)' },
    },
    {
      name: 'server-imports-core-only',
      comment:
        'packages/server is the API transport (D66 "api layer"): it may import @runwire/core ' +
        'and its own files, nothing else. The `$1` back-reference in `to.pathNot` self-exempts ' +
        "the server's own intra-package imports (e.g. index.ts → createServer.ts).",
      severity: 'error',
      from: { path: '^packages/(server)/' },
      to: { path: '^packages/(?!core|server)', pathNot: '^packages/$1/' },
    },
    {
      name: 'web-is-standalone-at-runtime',
      comment:
        'packages/web talks to @runwire/server only over HTTP (fetch); it may use `import type` ' +
        'from @runwire/core for DTO shapes (invisible to this graph, see header note above) but ' +
        'must have zero runtime repo imports.',
      severity: 'error',
      from: { path: '^packages/web' },
      to: { path: '^packages/(?!web)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.test\\.tsx?$', '(^|/)dist/'] },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], mainFields: ['main'] },
  },
};
