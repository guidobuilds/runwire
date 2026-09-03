/**
 * Token resolution for the L3 chart layer (design.md §4: "charts read colors
 * from the CSS vars ... never own hex").
 *
 * Two distinct needs, deliberately kept separate:
 *
 * 1. **Color for SVG `fill`/`stroke`.** `KIND_COLOR`/`CONFIDENCE_COLOR`/
 *    `USAGE_COLOR` below map each domain key straight to a `var(--token)`
 *    string (e.g. `"var(--kind-model)"`), never a resolved hex. SVG
 *    presentation attributes accept any CSS `<color>`, `var()` included, so
 *    charts pass these strings directly to `fill`/`stroke` — the browser's
 *    CSS engine resolves them, live, against whichever color scheme
 *    (`prefers-color-scheme`) is active. This is why the OS-driven light/dark
 *    switch (design.md §3) needs zero chart-side JS: an already-rendered
 *    chart repaints itself the instant the OS scheme flips, same as any
 *    other CSS-var-colored element on the page. It is also what makes the
 *    "tokens not hardcoded" contract trivially testable — assert the
 *    rendered `fill`/`stroke` attribute *is* the `var(--kind-model)` string,
 *    no DOM color resolution required in the test.
 *
 * 2. **Resolving an actual pixel/hex value from the DOM.** `resolveToken`
 *    exists for the rarer case where a real value (not a CSS string) is
 *    needed — e.g. feeding a computed color into a non-SVG canvas API, or a
 *    contrast calculation. It reads `getComputedStyle(target)` for the given
 *    custom-property name, via an **injectable** `getComputed` function
 *    (default: the real `window.getComputedStyle`) so tests can supply a
 *    fake. It falls back to `FALLBACK_TOKENS` (a static copy of the light
 *    palette from `styles.css`) whenever resolution comes back empty.
 *
 *    That fallback is required, not defensive-programming boilerplate.
 *    Empirically probed under this repo's actual test setup (Vitest +
 *    happy-dom, `packages/web/vite.config.ts`, no `test.css` override):
 *    `getComputedStyle` DOES correctly read a live custom property once one
 *    is actually present in the document — confirmed by injecting a
 *    `<style>` tag or calling `element.style.setProperty` directly and
 *    reading it back. The gap is upstream of happy-dom: `import
 *    './styles.css'` inside a Vitest test does **not** inject the real
 *    stylesheet into the document by default (Vitest only runs the actual
 *    CSS pipeline when `test.css` is enabled, which this repo's config does
 *    not set), so `--kind-model` etc. resolve to `""` under test even though
 *    the same lookup works perfectly at runtime in a real browser. Without
 *    the fallback, any test exercising `resolveToken` against the app's real
 *    styles.css tokens (as opposed to a hand-injected probe style) would
 *    silently assert against empty strings. Keep `FALLBACK_TOKENS` in sync
 *    with `styles.css`'s light-scheme values by hand; it is a test/off-DOM
 *    safety net, not the source of truth.
 */

export type KindKey =
  | 'model'
  | 'read'
  | 'write'
  | 'exec'
  | 'search'
  | 'plan'
  | 'agent'
  | 'web'
  | 'mcp'
  | 'skill'
  | 'todo'
  | 'prose'
  | 'error'
  | 'harness-event';

export type ConfidenceKey = 'high' | 'medium' | 'low';

export type UsageKey = 'uncached' | 'cached' | 'cache-write' | 'output' | 'reasoning';

export const KIND_KEYS: readonly KindKey[] = [
  'model',
  'read',
  'write',
  'exec',
  'search',
  'plan',
  'agent',
  'web',
  'mcp',
  'skill',
  'todo',
  'prose',
  'error',
  'harness-event',
];

export const CONFIDENCE_KEYS: readonly ConfidenceKey[] = ['high', 'medium', 'low'];

export const USAGE_KEYS: readonly UsageKey[] = [
  'uncached',
  'cached',
  'cache-write',
  'output',
  'reasoning',
];

function cssVarName(prefix: string, key: string): string {
  return `--${prefix}-${key}`;
}

function buildVarMap<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = `var(${cssVarName(prefix, key)})`;
  return out;
}

/** `KindKey -> "var(--kind-<key>)"`. Pass straight to an SVG `fill`/`stroke`. */
export const KIND_COLOR: Record<KindKey, string> = buildVarMap('kind', KIND_KEYS);

/** `ConfidenceKey -> "var(--confidence-<key>)"`. */
export const CONFIDENCE_COLOR: Record<ConfidenceKey, string> = buildVarMap(
  'confidence',
  CONFIDENCE_KEYS,
);

/** `UsageKey -> "var(--usage-<key>)"`. */
export const USAGE_COLOR: Record<UsageKey, string> = buildVarMap('usage', USAGE_KEYS);

/**
 * `KindKey -> Tailwind arbitrary-value background class`, for HTML legend
 * swatches (e.g. `TraceRibbon`'s kind legend) that need a per-kind fill but
 * are not SVG marks and therefore cannot use `KIND_COLOR` as a `fill`
 * attribute. Written as literal class strings (never built by string
 * interpolation) so Tailwind's static scanner — which reads this file's own
 * source text, per the repo's "Tailwind v4 scans source text" note — emits
 * the utility; a template-built class name would not be statically
 * analyzable and would silently produce no CSS. This is the same pattern
 * `primitives/ConfidenceDot.tsx`'s `DOT_TONE` already uses for
 * `--confidence-*`: a `className` through `cn()`, never `style={{ ... }}`
 * (design.md §1 / the repo's no-inline-CSS rule — legend swatches are
 * styling, not visx geometry, so they don't qualify for that rule's one
 * documented exception).
 */
export const KIND_BG_CLASS: Record<KindKey, string> = {
  model: 'bg-[var(--kind-model)]',
  read: 'bg-[var(--kind-read)]',
  write: 'bg-[var(--kind-write)]',
  exec: 'bg-[var(--kind-exec)]',
  search: 'bg-[var(--kind-search)]',
  plan: 'bg-[var(--kind-plan)]',
  agent: 'bg-[var(--kind-agent)]',
  web: 'bg-[var(--kind-web)]',
  mcp: 'bg-[var(--kind-mcp)]',
  skill: 'bg-[var(--kind-skill)]',
  todo: 'bg-[var(--kind-todo)]',
  prose: 'bg-[var(--kind-prose)]',
  error: 'bg-[var(--kind-error)]',
  'harness-event': 'bg-[var(--kind-harness-event)]',
};

/** `UsageKey -> Tailwind arbitrary-value background class`. See `KIND_BG_CLASS` doc comment. */
export const USAGE_BG_CLASS: Record<UsageKey, string> = {
  uncached: 'bg-[var(--usage-uncached)]',
  cached: 'bg-[var(--usage-cached)]',
  'cache-write': 'bg-[var(--usage-cache-write)]',
  output: 'bg-[var(--usage-output)]',
  reasoning: 'bg-[var(--usage-reasoning)]',
};

/**
 * D36 + design.md §4: low/medium-confidence chart series render at reduced
 * opacity; the data marks' own kind/usage color never changes for
 * confidence. A plain numeric constant, not a token — no `--confidence-*`
 * var exists (or should exist) for an opacity value, since opacity is a
 * chart-rendering choice, not a design-system color.
 */
export const CONFIDENCE_OPACITY: Record<ConfidenceKey, number> = {
  high: 1,
  medium: 0.6,
  low: 0.6,
};

/**
 * timeline-chart-usability design.md §1 (Decision B, hover-dim-by-agent): a
 * mark whose `agentId` does NOT match `TimelineContext.hoveredAgentId`
 * renders at this opacity, OVERRIDING (not multiplying) any
 * `CONFIDENCE_OPACITY`-derived opacity it would otherwise have -- a dimmed-
 * because-not-hovered mark should read as "dimmed" first, not as a compound
 * of two independent opacity systems. Deliberately more aggressive than
 * `CONFIDENCE_OPACITY`'s lowest value (`0.6`) so the two states stay visually
 * distinct from each other. A plain numeric constant, not a token -- same
 * "opacity is a chart-rendering choice, not a design-system color" rationale
 * as `CONFIDENCE_OPACITY` above.
 */
export const HOVER_DIM_OPACITY = 0.15;

/**
 * Light-scheme fallback, hand-copied from `packages/web/src/styles.css`
 * (`:root` block). Used only by `resolveToken` when a live DOM lookup comes
 * back empty (see the module doc comment above for why that happens under
 * this repo's test setup). Never imported by anything that renders chart
 * color directly — those use `KIND_COLOR`/`CONFIDENCE_COLOR`/`USAGE_COLOR`
 * (`var()` strings) instead.
 */
const FALLBACK_TOKENS: Record<string, string> = {
  '--confidence-high': '#42825d',
  '--confidence-medium': '#966e31',
  '--confidence-low': '#b65b5b',
  '--kind-model': '#3d6fd6',
  '--kind-read': '#3f8f8a',
  '--kind-write': '#c2782e',
  '--kind-exec': '#7a5cc7',
  '--kind-search': '#2f8f5a',
  '--kind-plan': '#a8562f',
  '--kind-agent': '#2670a8',
  '--kind-web': '#0f8fae',
  '--kind-mcp': '#8a4fae',
  '--kind-skill': '#b23d82',
  '--kind-todo': '#8a7a1f',
  '--kind-prose': '#5a5f6b',
  '--kind-error': '#c23f3f',
  '--kind-harness-event': '#4f7a3f',
  '--usage-uncached': '#5a6270',
  '--usage-cached': '#3f8f8a',
  '--usage-cache-write': '#7a5cc7',
  '--usage-output': '#2f8f5a',
  '--usage-reasoning': '#c2782e',
};

export type ComputedStyleLike = { getPropertyValue(name: string): string };
export type GetComputed = (target: Element) => ComputedStyleLike;

const defaultGetComputed: GetComputed = (target) => getComputedStyle(target);

/**
 * Resolves one `--token-name` custom property to its actual computed value
 * against `target` (default: `document.documentElement`). `getComputed` is
 * injectable so a test can supply a fake `ComputedStyleLike` without relying
 * on a real stylesheet being present in the document — see the module doc
 * comment for why that matters under this repo's Vitest config. Falls back
 * to `FALLBACK_TOKENS` when the live lookup returns an empty string.
 */
export function resolveToken(
  varName: string,
  target: Element = document.documentElement,
  getComputed: GetComputed = defaultGetComputed,
): string {
  const live = getComputed(target).getPropertyValue(varName).trim();
  if (live !== '') return live;
  return FALLBACK_TOKENS[varName] ?? live;
}
