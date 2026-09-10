import type { Database } from 'bun:sqlite';
import {
  getSession,
  type ListSessionsQuery,
  listSessions,
  readProfileMergedEvents,
  readProfileModels,
  readProfileSignals,
  readProfileSpawns,
  readProfileTimeline,
} from '@scout/core';
import { parseProfileQuery } from './profile-query';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

export type CreateServerOptions = {
  db: Database;
  host: string;
  port: number;
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/** Every 405 carries an `Allow: GET` header (design D-L, RFC 9110). */
function methodNotAllowed(): Response {
  return json({ error: 'method not allowed' }, 405, { allow: 'GET' });
}

/** The only query params accepted on `GET /api/sessions` (design D-3). */
const VALID_QUERY_PARAMS = new Set(['limit', 'offset', 'harness', 'startedAfter', 'model']);

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
    fetch(req) {
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
            { service: 'scout', endpoints: ['/api/sessions', '/api/sessions/{id}'] },
            200,
          );
        }
        if (path === SESSIONS_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          const params = new URL(req.url).searchParams;

          // Unknown query param (D-3): a typo'd filter must not silently pass.
          for (const key of params.keys()) {
            if (!VALID_QUERY_PARAMS.has(key)) return invalidQueryParam(key);
          }
          // Duplicate query param (D-3): ambiguous; first-wins would be lenient.
          for (const key of params.keys()) {
            if (params.getAll(key).length > 1) return invalidQueryParam(key);
          }

          const query: ListSessionsQuery = {};

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
          const harness = params.get('harness');
          if (harness !== null) {
            if (harness.trim() === '') return invalidQueryParam('harness');
            query.harness = harness;
          }
          const model = params.get('model');
          if (model !== null) {
            if (model.trim() === '') return invalidQueryParam('model');
            query.model = model;
          }
          const startedAfter = params.get('startedAfter');
          if (startedAfter !== null) {
            // GUARD before normalizing (D-4): `new Date(value).toISOString()`
            // throws a RangeError on an invalid date, which the outer catch
            // would surface as a 500. Validate the date first, then normalize
            // to canonical `.sssZ` UTC.
            if (Number.isNaN(new Date(startedAfter).getTime())) {
              return invalidQueryParam('startedAfter');
            }
            query.startedAfter = new Date(startedAfter).toISOString();
          }

          return json(listSessions(db, query), 200);
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
        return json({ error: 'not found' }, 404);
      } catch {
        return json({ error: 'internal error' }, 500);
      }
    },
  });
}
