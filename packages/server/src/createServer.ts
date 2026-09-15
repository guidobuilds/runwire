import type { Database } from 'bun:sqlite';
import {
  getSession,
  getSessionsStats,
  type ImportReport,
  type ListSessionsQuery,
  listHarnesses,
  listSessions,
  readProfileMergedEvents,
  readProfileModels,
  readProfileSignals,
  readProfileSpawns,
  readProfileTimeline,
} from '@runwire/core';
import { parseProfileQuery } from './profile-query';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

export type CreateServerOptions = {
  db: Database;
  host: string;
  port: number;
  /**
   * Runs a full import (the `runwire import` orchestrator) when the web UI POSTs
   * `/api/scan`. The CLI composition root injects it because the adapter
   * registry lives there; the transport layer stays adapter-agnostic. Omitted
   * when the server is embedded without a scan source, which returns 503.
   */
  scan?: () => Promise<ImportReport>;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/** Every 405 carries an `Allow` header naming the only accepted method
 * (design D-L, RFC 9110). Defaults to `GET`; `/api/scan` allows `POST` only. */
function methodNotAllowed(allow = 'GET'): Response {
  return json({ error: 'method not allowed' }, 405, { allow });
}

/** The only query params accepted on `GET /api/sessions` (design D-3). */
const VALID_QUERY_PARAMS = new Set([
  'limit',
  'offset',
  'harness',
  'startedAfter',
  'model',
  'q',
  'durationMin',
  'costOnly',
  'sort',
]);

/** The only query params accepted on `GET /api/sessions/stats`: the filters
 * shared with `/api/sessions`, with no `limit`/`offset`/`sort` — stats are
 * aggregates over the whole filtered set and have no page or order. */
const VALID_STATS_QUERY_PARAMS = new Set([
  'harness',
  'startedAfter',
  'model',
  'q',
  'durationMin',
  'costOnly',
]);

/** A whitelisted `sort` field, optionally `-`-prefixed for DESC (design D-3). */
const SORT_PATTERN = /^-?(name|harness|startedAt|duration|tokens|cost)$/;

/** A strict 400 for any unknown, duplicate, or invalid query parameter (D-3/D-13). */
function invalidQueryParam(parameter: string): Response {
  return json({ error: 'invalid query parameter', parameter }, 400);
}

/**
 * Parse a non-negative integer query param. `value` must be non-empty and all
 * digits (`/^\d+$/`) — a leading `+`, a decimal, a negative, `0` below `min`,
 * or an empty value all reject. `max` is `Number.MAX_SAFE_INTEGER` for `offset`.
 */
function parseIntegerParam(value: string, min: number, max: number): number | null {
  if (value === '' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < min || n > max) return null;
  return n;
}

/**
 * Rejects the first unknown or duplicate query param (design D-3): a typo'd or
 * repeated filter must not silently pass. `valid` is the endpoint's whitelist,
 * so each endpoint keeps its own surface (the stats endpoint excludes
 * `limit`/`offset`/`sort`).
 */
function checkParamNames(
  params: URLSearchParams,
  valid: Set<string>,
): { ok: true } | { ok: false; parameter: string } {
  for (const key of params.keys()) {
    if (!valid.has(key)) return { ok: false, parameter: key };
  }
  for (const key of params.keys()) {
    if (params.getAll(key).length > 1) return { ok: false, parameter: key };
  }
  return { ok: true };
}

/**
 * Strict parser for the filter params shared by `GET /api/sessions` and
 * `GET /api/sessions/stats`, so the two can never drift. Pagination and `sort`
 * are deliberately NOT here — `listSessions` parses those itself and the stats
 * endpoint rejects them. Returns the first invalid parameter, or the built
 * `ListSessionsQuery`.
 */
function parseFilterParams(
  params: URLSearchParams,
): { ok: true; query: ListSessionsQuery } | { ok: false; parameter: string } {
  const query: ListSessionsQuery = {};

  const harness = params.get('harness');
  if (harness !== null) {
    // Comma list is split/trimmed/de-duped in core; here every segment
    // must be non-empty so `harness=a,,b` (or a bare blank) is a 400.
    if (harness.split(',').some((segment) => segment.trim() === '')) {
      return { ok: false, parameter: 'harness' };
    }
    query.harness = harness;
  }
  const model = params.get('model');
  if (model !== null) {
    if (model.trim() === '') return { ok: false, parameter: 'model' };
    query.model = model;
  }
  const q = params.get('q');
  if (q !== null) {
    // Non-empty after trim, but passed verbatim (the leading/trailing
    // whitespace may be intentional in the user's query text; core
    // matches it as-is).
    if (q.trim() === '') return { ok: false, parameter: 'q' };
    query.q = q;
  }
  const durationMinRaw = params.get('durationMin');
  if (durationMinRaw !== null) {
    // Integer >= 1 minute; 0, negatives, decimals and non-digits reject.
    const durationMin = parseIntegerParam(durationMinRaw, 1, Number.MAX_SAFE_INTEGER);
    if (durationMin === null) return { ok: false, parameter: 'durationMin' };
    query.durationMin = durationMin;
  }
  const costOnlyRaw = params.get('costOnly');
  if (costOnlyRaw !== null) {
    // Exactly `true` or `false`; `false` means no cost filter.
    if (costOnlyRaw !== 'true' && costOnlyRaw !== 'false') {
      return { ok: false, parameter: 'costOnly' };
    }
    if (costOnlyRaw === 'true') query.costOnly = true;
  }
  const startedAfter = params.get('startedAfter');
  if (startedAfter !== null) {
    // GUARD before normalizing (D-4): `new Date(value).toISOString()`
    // throws a RangeError on an invalid date, which the outer catch
    // would surface as a 500. Validate the date first, then normalize
    // to canonical `.sssZ` UTC.
    if (Number.isNaN(new Date(startedAfter).getTime())) {
      return { ok: false, parameter: 'startedAfter' };
    }
    query.startedAfter = new Date(startedAfter).toISOString();
  }

  return { ok: true, query };
}

/**
 * Pure, testable transport factory (design D-N): no flag parsing, no process
 * lifecycle, no CORS headers. `Bun.serve`'s bind option is `hostname`, not
 * `host` — a bare `host` is silently ignored and would bind `0.0.0.0`,
 * breaking the loopback-only default (design D-G). Routes API paths first so a
 * future static/SPA fallback (design D-N / ADR-8) is a contained addition.
 *
 * **API-only under `/api`.** Every endpoint is served exclusively under
 * `/api/*`; the root `/` and the legacy `/sessions*` / `/session-profiles*`
 * paths are intentionally NOT routed (they fall through to a 404) and there is
 * no alias or redirect. The frontend (a separate Vite SPA in dev) owns `/` and
 * its own `/sessions*` pages; the server never serves static files.
 * Static serving is out of scope for this delivery.
 */
const API_PREFIX = '/api';
const SESSIONS_PREFIX = `${API_PREFIX}/sessions`;
const SESSIONS_STATS_PREFIX = `${SESSIONS_PREFIX}/stats`;
const HARNESSES_PREFIX = `${API_PREFIX}/harnesses`;
const SCAN_PREFIX = `${API_PREFIX}/scan`;
const PROFILE_ENDPOINTS = ['spawns', 'signals', 'timeline', 'events', 'models'] as const;

type ProfileEndpoint = (typeof PROFILE_ENDPOINTS)[number];

function profileEndpoint(path: string): { encodedId: string; endpoint: ProfileEndpoint } | null {
  for (const endpoint of PROFILE_ENDPOINTS) {
    const suffix = `/profile/${endpoint}`;
    if (!path.startsWith(`${SESSIONS_PREFIX}/`) || !path.endsWith(suffix)) continue;
    const encodedId = path.slice(`${SESSIONS_PREFIX}/`.length, -suffix.length);
    return encodedId === '' ? null : { encodedId, endpoint };
  }
  return null;
}

export function createServer(opts: CreateServerOptions): Bun.Server<unknown> {
  const { db, host, port } = opts;
  return Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      // Derive path from the URL, never `req.url` (the full absolute URL with
      // origin + query), so `/api/sessions?x=1` does not brute-match `/api/sessions`.
      let path: string;
      try {
        path = new URL(req.url).pathname;
      } catch {
        return json({ error: 'invalid request' }, 400);
      }
      const method = req.method;
      try {
        if (path === API_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          return json(
            {
              service: 'runwire',
              endpoints: [
                '/api/sessions',
                '/api/sessions/stats',
                '/api/sessions/{id}',
                '/api/harnesses',
                '/api/scan',
              ],
            },
            200,
          );
        }
        if (path === SCAN_PREFIX) {
          // `POST` is the only accepted method (it has an effect: it writes
          // imported sessions); the check comes first so a wrong method is
          // a 405 even when no scan callback was injected.
          if (method !== 'POST') return methodNotAllowed('POST');
          if (opts.scan === undefined) {
            return json({ error: 'scan unavailable' }, 503);
          }
          const report = await opts.scan();
          // Mirror the CLI's failure rule: an adapter `error` or any failed
          // bundle in the `ImportReport` is a failed scan. Returning 2xx here
          // would let the web UI treat a partial import as success and
          // navigate away from the dialog that reports what failed.
          const failed = Object.values(report.perAdapter).some(
            (entry) => entry.error !== undefined || entry.failed > 0,
          );
          if (failed) {
            return json({ error: 'one or more imports failed', report }, 500);
          }
          return json(report, 200);
        }
        if (path === SESSIONS_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          const params = new URL(req.url).searchParams;

          const names = checkParamNames(params, VALID_QUERY_PARAMS);
          if (!names.ok) return invalidQueryParam(names.parameter);
          const filters = parseFilterParams(params);
          if (!filters.ok) return invalidQueryParam(filters.parameter);
          const query = filters.query;

          const limitRaw = params.get('limit');
          if (limitRaw !== null) {
            // `limit` must be an integer in [1, 200]; 0, negatives, >200,
            // decimals, a leading `+`, and empty all reject (D-2).
            const limit = parseIntegerParam(limitRaw, 1, 200);
            if (limit === null) return invalidQueryParam('limit');
            query.limit = limit;
          }
          const offsetRaw = params.get('offset');
          if (offsetRaw !== null) {
            const offset = parseIntegerParam(offsetRaw, 0, Number.MAX_SAFE_INTEGER);
            if (offset === null) return invalidQueryParam('offset');
            query.offset = offset;
          }
          const sortRaw = params.get('sort');
          if (sortRaw !== null) {
            // Whitelisted field, optional `-` DESC prefix, case-sensitive.
            if (!SORT_PATTERN.test(sortRaw)) return invalidQueryParam('sort');
            query.sort = sortRaw;
          }

          return json(listSessions(db, query), 200);
        }
        if (path === SESSIONS_STATS_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          const params = new URL(req.url).searchParams;
          // Filters only: `limit`/`offset`/`sort` are rejected as unknown here —
          // aggregates cover the whole filtered set and have no page or order.
          const names = checkParamNames(params, VALID_STATS_QUERY_PARAMS);
          if (!names.ok) return invalidQueryParam(names.parameter);
          const filters = parseFilterParams(params);
          if (!filters.ok) return invalidQueryParam(filters.parameter);
          return json(getSessionsStats(db, filters.query), 200);
        }
        const scopedProfile = profileEndpoint(path);
        if (scopedProfile !== null) {
          if (method !== 'GET') return methodNotAllowed();
          let id: string;
          try {
            id = decodeURIComponent(scopedProfile.encodedId);
          } catch {
            return json({ error: 'invalid id' }, 400);
          }
          const view = scopedProfile.endpoint === 'events' ? 'merged' : scopedProfile.endpoint;
          const parsed = parseProfileQuery(new URL(req.url).searchParams, view);
          if (!parsed.ok) return invalidQueryParam(parsed.parameter);

          if (parsed.value.view === 'spawns') {
            const profile = readProfileSpawns(db, id, parsed.value.query);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'spawns', ...profile }, 200);
          }
          if (parsed.value.view === 'signals') {
            const profile = readProfileSignals(db, id, parsed.value.query);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'signals', ...profile }, 200);
          }
          if (parsed.value.view === 'timeline') {
            const profile = readProfileTimeline(db, id, parsed.value.query);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'timeline', ...profile }, 200);
          }
          if (parsed.value.view === 'models') {
            const profile = readProfileModels(db, id);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'models', ...profile }, 200);
          }
          const profile = readProfileMergedEvents(db, id, parsed.value.query);
          return profile === null
            ? json({ error: 'session not found' }, 404)
            : json({ view: 'merged', ...profile }, 200);
        }
        if (path.startsWith(`${SESSIONS_PREFIX}/`)) {
          if (method !== 'GET') return methodNotAllowed();
          // Whole-remainder id (design D-H): a literal `/` (or an encoded
          // `%2F`) stays part of the id, so Claude subagent ids work.
          let id: string;
          try {
            id = decodeURIComponent(path.slice(`${SESSIONS_PREFIX}/`.length));
          } catch {
            return json({ error: 'invalid id' }, 400);
          }
          const session = getSession(db, id);
          if (session === null) return json({ error: 'session not found' }, 404);
          return json({ session }, 200);
        }
        if (path === HARNESSES_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          // No query params are accepted on this endpoint (D-3): any param is
          // a typo'd request, so reject the first one.
          const params = new URL(req.url).searchParams;
          for (const key of params.keys()) {
            return invalidQueryParam(key);
          }
          return json(listHarnesses(db), 200);
        }
        return json({ error: 'not found' }, 404);
      } catch {
        return json({ error: 'internal error' }, 500);
      }
    },
  });
}
