export type Projection = { [key: string]: true | Projection | [Projection] };

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
