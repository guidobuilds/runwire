/**
 * A nested description of the only keys a raw record may keep.
 * `true` keeps the value as-is (a leaf, trusted verbatim); a nested object
 * recurses into that key; a one-element array recurses into each array
 * element. Anything not named in the projection is dropped.
 */
export type Projection = { [key: string]: true | Projection | [Projection] };

/**
 * Builds a new object containing only the allowlisted keys, before any
 * further validation runs (docs/ARCHITECTURE.md §6, mechanism 1). Never
 * mutates `record`.
 */
export function project(record: unknown, allowlist: Projection): unknown {
  if (record === null || typeof record !== 'object') return undefined;
  if (Array.isArray(record)) return undefined;

  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, rule] of Object.entries(allowlist)) {
    if (!(key in source)) continue;
    const value = source[key];

    if (rule === true) {
      out[key] = value;
      continue;
    }

    if (Array.isArray(rule)) {
      const elementRule = rule[0];
      if (!Array.isArray(value)) continue;
      out[key] = value.map((el) => project(el, elementRule));
      continue;
    }

    const projected = project(value, rule);
    if (projected !== undefined) out[key] = projected;
  }

  return out;
}
