export { createOpencodeAdapter } from './adapter';

// Metadata-only connector surface (design §4). The connector returns only
// non-sensitive CORE-representable data (project + session + steps +
// diagnostics) — the same data the bundle path produces, for one session on
// demand. No content parts, no `rawBase64`, no `sensitive`/`enrich` options.
export { inventorySessions, retrieveSession, retrieveSessionParts } from './connector/retrieve';
export type { SessionDetails, SessionSummary, SourceRef, TokenTotals } from './connector/types';
export type { DbOrigin } from './paths';
