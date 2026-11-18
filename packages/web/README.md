# @runwire/web

The Runwire web explorer. It is a React 19 + Vite + TanStack Router single-page app that talks to
`@runwire/server` over HTTP. It has no runtime imports from the rest of the repository.

```sh
bun run dev        # Vite dev server on :5173, proxying /api to :8787
bun run test       # Vitest + jsdom
bun run typecheck
bun run build
```

Run the API with `bun run runwire serve` from the repository root, or start both halves with
`bun run dev` at the root.

This package is beta: some panels are still being designed. The router tree
(`src/routeTree.gen.ts`) and the shadcn/ui primitives (`src/components/ui/**`) are generated; do not
edit them by hand.
