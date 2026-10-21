/**
 * Model catalog: context window and capability tier resolved in a cascade —
 * exact `provider/model` → exact by name → prefix → unknown.
 *
 * This is configuration, not ground truth. A model that matches nothing
 * resolves to `null` for both fields; the consumer must then skip the
 * context-% drawing and exclude the model from tier-based rules.
 *
 * Identity follows the store: `(provider, name)`, where provider is
 * the serving provider the harness reported (`nan`, `openai`, `openai-codex`)
 * and is NULL for harnesses that don't report one (Claude Code). The exact-name
 * layer absorbs cross-harness variance (`gpt-6.1-sol` is `openai` on OpenCode
 * but `openai-codex` on Pi): a window is a property of the model, so built-in
 * exact entries are declared by name; provider-exact entries exist for the
 * case where a specific provider serves a model under a different window.
 * User overrides (`~/.runwire/models.json`) beat every built-in at exact match
 * only (S7) and are re-read on every request — editing the file never needs a
 * restart.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path/posix';

export type ModelTier = 'high' | 'mid' | 'low';

export type ModelCatalogEntry = {
  /** Tokens. `null` when unknown — no context % is drawn for the model. */
  contextWindow: number | null;
  /** `null` when unknown — the model is excluded from tier-based detections. */
  tier: ModelTier | null;
};

/** One user override row from `~/.runwire/models.json`. */
export type ModelOverride = {
  /** Absent → the override matches by name for every provider (incl. NULL). */
  provider?: string;
  model: string;
  contextWindow: number;
};

type CatalogRule = {
  /** Case-insensitive prefix. A rule matches when the name starts with it. */
  prefix: string;
} & ModelCatalogEntry;

/** Exact `provider/model` entries (provider-scoped window differences). */
const EXACT_PROVIDER_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  ['openai/gpt-6.1-sol', { contextWindow: 1_050_000, tier: 'high' }],
  ['openai/gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  ['anthropic/claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
]);

/**
 * Exact name entries. Values declared by Guido ( S3); `claude-opus-5*`
 * carries 1M evidence (877k prompts in the real DB).
 */
const EXACT_NAME_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  ['gpt-6.1-sol', { contextWindow: 1_050_000, tier: 'high' }],
  ['gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  ['claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
  ['claude-opus-5', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-opus-5-5', { contextWindow: 1_000_000, tier: 'high' }],
]);

/**
 * Ordered by specificity: the first matching rule wins. Prefixes are plain
 * startsWith checks on the lowercased name; a rule without the trailing dash
 * (e.g. `glm`) matches names that continue with a digit or letter.
 */
const RULES: readonly CatalogRule[] = [
  // Claude: 1M-token betas exist for opus/sonnet-5-5 (declared above); the
  // safe default for the rest is 200k.
  { prefix: 'claude-opus-', contextWindow: 200_000, tier: 'high' },
  { prefix: 'claude-sonnet-', contextWindow: 200_000, tier: 'mid' },
  { prefix: 'claude-haiku-', contextWindow: 200_000, tier: 'low' },
  { prefix: 'gpt-6', contextWindow: 400_000, tier: 'high' },
  { prefix: 'gpt-5', contextWindow: 400_000, tier: 'high' },
  { prefix: 'deepseek-', contextWindow: 128_000, tier: 'mid' },
  { prefix: 'glm', contextWindow: 300_000, tier: 'low' },
];

const UNKNOWN: ModelCatalogEntry = { contextWindow: null, tier: null };

const byPrefix = (name: string): ModelCatalogEntry => {
  const lower = name.toLowerCase();
  for (const rule of RULES) {
    if (lower.startsWith(rule.prefix))
      return { contextWindow: rule.contextWindow, tier: rule.tier };
  }
  return UNKNOWN;
};

/**
 * Resolve one model against the catalog cascade. Never throws; unknown names
 * resolve to `null` fields. Overrides win at exact match only (S7): a
 * provider-scoped override beats a name-only one, and both beat any built-in.
 */
export function resolveModelCatalog(
  provider: string | null | undefined,
  name: string,
  overrides: readonly ModelOverride[] = [],
): ModelCatalogEntry {
  const lowerName = name.toLowerCase();
  const lowerProvider = provider?.toLowerCase();

  let providerScoped: ModelOverride | undefined;
  let nameOnly: ModelOverride | undefined;
  for (const override of overrides) {
    if (override.model.toLowerCase() !== lowerName) continue;
    if (override.provider === undefined) nameOnly ??= override;
    else if (override.provider.toLowerCase() === lowerProvider) providerScoped ??= override;
  }

  const tierOf = (contextWindow: number): ModelCatalogEntry => ({
    contextWindow,
    // Overrides declare windows only; the tier still comes from the built-in
    // view of the model (exact entry first, then prefix).
    tier:
      EXACT_PROVIDER_ENTRIES.get(`${lowerProvider}/${lowerName}`)?.tier ??
      EXACT_NAME_ENTRIES.get(lowerName)?.tier ??
      byPrefix(name).tier,
  });

  if (providerScoped !== undefined) return tierOf(providerScoped.contextWindow);
  if (lowerProvider !== undefined && lowerProvider !== '') {
    const exactProvider = EXACT_PROVIDER_ENTRIES.get(`${lowerProvider}/${lowerName}`);
    if (exactProvider !== undefined) return exactProvider;
  }
  if (nameOnly !== undefined) return tierOf(nameOnly.contextWindow);
  const exactName = EXACT_NAME_ENTRIES.get(lowerName);
  if (exactName !== undefined) return exactName;
  return byPrefix(name);
}

/** Backward-compatible name-only resolution (NULL provider). */
export function lookupModelCatalog(name: string): ModelCatalogEntry {
  return resolveModelCatalog(null, name);
}

/**
 * Parse the user's override list. Only well-formed rows survive: a non-list
 * root, non-object rows, missing model, or a non-finite/absent positive
 * contextWindow are skipped. Never throws.
 */
export function parseModelOverrides(raw: unknown): ModelOverride[] {
  if (!Array.isArray(raw)) return [];
  const overrides: ModelOverride[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const { provider, model, contextWindow } = row as Record<string, unknown>;
    if (typeof model !== 'string' || model === '') continue;
    if (
      typeof contextWindow !== 'number' ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0
    ) {
      continue;
    }
    if (provider !== undefined && (typeof provider !== 'string' || provider === '')) continue;
    overrides.push({
      provider: provider === undefined ? undefined : (provider as string),
      model,
      contextWindow,
    });
  }
  return overrides;
}

/**
 * Read `~/.runwire/models.json` (list of objects). A missing file, malformed
 * JSON or a non-list root resolve to no overrides — the file is user input,
 * and a bad edit must never take the API down. Re-read on every call: the
 * caller invokes this per request so edits apply without a restart.
 */
export function readModelOverrides(path: string): ModelOverride[] {
  try {
    return parseModelOverrides(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
}

/** Default override file location: `<home>/.runwire/models.json`. */
export function modelsOverridesPath(home: string): string {
  return join(home, '.runwire', 'models.json');
}
