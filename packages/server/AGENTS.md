- API transport (D66): imports `@runwire/core` and its own files only. JSON in/out.
- Every endpoint lives under `/api*`; the server serves no static files.

# Checks

```sh
cd packages/server
bun test
bun run typecheck
```

# Tests

- Use the real server: `createServer({ db, host: '127.0.0.1', port: 0 })` with a
  `:memory:` store (`openStore(':memory:')`), then hit it with `fetch`. Do not mock
  the transport.
- Seed rows with direct SQL helpers, like `seed()` in `serve.test.ts`.

# API rules

- Unknown/duplicate/invalid query params → 400. Each endpoint has its own whitelist;
  `/api/sessions/stats` accepts filters only (no `limit`/`offset`/`sort`).
- Non-GET on a known path → 405 with `Allow: GET`.
- A session id is the whole path remainder (a literal `/` or `%2F` stays in the id).
- Parse integers/booleans strictly (`parseIntegerParam`); validate dates before
  `toISOString()`.
- Update the Bruno collection in `collections/sessions-api/` when an endpoint changes.
