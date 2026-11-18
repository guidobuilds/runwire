import type { Database } from 'bun:sqlite';
import {
  getSession,
  getSessionsStats,
  type ImportReport,
  type ListSessionsQuery,
  listHarnesses,
  listSessions,
  type ModelOverride,
  readProfileLanes,
  readProfileMergedEvents,
  readProfileModels,
  readProfileSessionContext,
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
  scan?: () => Promise<ImportReport>;
  allowNonLocal?: boolean;
  modelOverrides?: () => readonly ModelOverride[];
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function assertBindHost(host: string, allowNonLocal: boolean): void {
  if (host === '') {
    throw new Error('refusing to bind an empty host');
  }
  if (allowNonLocal) return;
  const loopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!loopback) {
    throw new Error(
      `refusing to bind ${host}: pass allowNonLocal to expose the unauthenticated API`,
    );
  }
}

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function methodNotAllowed(allow = 'GET'): Response {
  return json({ error: 'method not allowed' }, 405, { allow });
}

const SCAN_CSRF_HEADER = 'x-runwire-scan';

function hasScanCsrfProof(req: Request): boolean {
  if (req.headers.get(SCAN_CSRF_HEADER) === '1') return true;
  const contentType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  return contentType === 'application/json';
}

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

const VALID_STATS_QUERY_PARAMS = new Set([
  'harness',
  'startedAfter',
  'model',
  'q',
  'durationMin',
  'costOnly',
]);

const SORT_PATTERN = /^-?(name|harness|startedAt|lastActivity|duration|tokens|cost)$/;

function invalidQueryParam(parameter: string): Response {
  return json({ error: 'invalid query parameter', parameter }, 400);
}

function parseIntegerParam(value: string, min: number, max: number): number | null {
  if (value === '' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < min || n > max) return null;
  return n;
}

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

function parseFilterParams(
  params: URLSearchParams,
): { ok: true; query: ListSessionsQuery } | { ok: false; parameter: string } {
  const query: ListSessionsQuery = {};

  const harness = params.get('harness');
  if (harness !== null) {
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
    if (q.trim() === '') return { ok: false, parameter: 'q' };
    query.q = q;
  }
  const durationMinRaw = params.get('durationMin');
  if (durationMinRaw !== null) {
    const durationMin = parseIntegerParam(durationMinRaw, 1, Number.MAX_SAFE_INTEGER);
    if (durationMin === null) return { ok: false, parameter: 'durationMin' };
    query.durationMin = durationMin;
  }
  const costOnlyRaw = params.get('costOnly');
  if (costOnlyRaw !== null) {
    if (costOnlyRaw !== 'true' && costOnlyRaw !== 'false') {
      return { ok: false, parameter: 'costOnly' };
    }
    if (costOnlyRaw === 'true') query.costOnly = true;
  }
  const startedAfter = params.get('startedAfter');
  if (startedAfter !== null) {
    if (Number.isNaN(new Date(startedAfter).getTime())) {
      return { ok: false, parameter: 'startedAfter' };
    }
    query.startedAfter = new Date(startedAfter).toISOString();
  }

  return { ok: true, query };
}

const API_PREFIX = '/api';
const SESSIONS_PREFIX = `${API_PREFIX}/sessions`;
const SESSIONS_STATS_PREFIX = `${SESSIONS_PREFIX}/stats`;
const HARNESSES_PREFIX = `${API_PREFIX}/harnesses`;
const SCAN_PREFIX = `${API_PREFIX}/scan`;
const PROFILE_ENDPOINTS = [
  'spawns',
  'signals',
  'timeline',
  'events',
  'models',
  'context',
  'lanes',
] as const;

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
  assertBindHost(host, opts.allowNonLocal === true);
  let scanInFlight: Promise<ImportReport> | undefined;
  return Bun.serve({
    hostname: host,
    port,
    idleTimeout: 0,
    maxRequestBodySize: 1024,
    async fetch(req, server) {
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
          if (method !== 'POST') return methodNotAllowed('POST');
          if (!hasScanCsrfProof(req)) {
            return json({ error: 'forbidden' }, 403);
          }
          if (opts.scan === undefined) {
            return json({ error: 'scan unavailable' }, 503);
          }
          if (scanInFlight !== undefined) {
            return json({ error: 'scan in progress' }, 409);
          }
          server.timeout(req, 0);
          const inflight = opts.scan();
          scanInFlight = inflight;
          try {
            const report = await inflight;
            const failed = Object.values(report.perAdapter).some(
              (entry) => entry.error !== undefined || entry.failed > 0,
            );
            if (failed) {
              return json({ error: 'one or more imports failed', report }, 500);
            }
            return json(report, 200);
          } finally {
            scanInFlight = undefined;
          }
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
            if (!SORT_PATTERN.test(sortRaw)) return invalidQueryParam('sort');
            query.sort = sortRaw;
          }

          return json(listSessions(db, query), 200);
        }
        if (path === SESSIONS_STATS_PREFIX) {
          if (method !== 'GET') return methodNotAllowed();
          const params = new URL(req.url).searchParams;
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
          if (parsed.value.view === 'lanes') {
            const profile = readProfileLanes(
              db,
              id,
              parsed.value.query,
              opts.modelOverrides?.() ?? [],
            );
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'lanes', ...profile }, 200);
          }
          if (parsed.value.view === 'models') {
            const profile = readProfileModels(db, id);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'models', ...profile }, 200);
          }
          if (parsed.value.view === 'context') {
            const profile = readProfileSessionContext(db, id);
            return profile === null
              ? json({ error: 'session not found' }, 404)
              : json({ view: 'context', ...profile }, 200);
          }
          const profile = readProfileMergedEvents(db, id, parsed.value.query);
          return profile === null
            ? json({ error: 'session not found' }, 404)
            : json({ view: 'merged', ...profile }, 200);
        }
        if (path.startsWith(`${SESSIONS_PREFIX}/`)) {
          if (method !== 'GET') return methodNotAllowed();
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
