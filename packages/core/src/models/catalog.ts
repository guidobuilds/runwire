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

/**
 * Exact `provider/model` entries (provider-scoped window differences). Anchors
 * declared by Guido ( S3); the name-level map carries the full set.
 */
const EXACT_PROVIDER_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  ['openai/gpt-6.1-sol', { contextWindow: 1_050_000, tier: 'high' }],
  ['openai/gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  ['anthropic/claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
]);

/**
 * Exact name entries. Sourced from vendor docs on 2026-10-21:
 * OpenAI model pages (gpt-6/6.1/5.6/5.5 = 1,050,000), Anthropic help center
 * "context windows" table (Opus 5/5.5, Sonnet 5/5.5, Haiku 5.5, Fable 5.1 =
 * 1M; Opus 4.6–4.8, Sonnet 4.6, Fable 5 = 500K), DeepSeek V4 announcement
 * (Pro/Flash = 1,048,576), GLM-5.3-Flash docs (1,048,576; GLM-5 = 200K),
 * Gemini API docs (1M) and the Gemma 4 model card (up to 256K). `gpt-5.1`
 * keeps Guido's declared 400K — older generation than the 5.5/5.6 family.
 */
const EXACT_NAME_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  // OpenAI — the 5.5/5.6 and 6/6.1 families share the 1,050,000 window;
  // gpt-5.1 is the declared exception covered below instead of the prefix.
  ['gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  // Anthropic
  ['claude-opus-5-5', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-opus-5', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-opus-4-7', { contextWindow: 500_000, tier: 'high' }],
  ['claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
  ['claude-sonnet-5', { contextWindow: 1_000_000, tier: 'mid' }],
  ['claude-haiku-5-5', { contextWindow: 1_000_000, tier: 'low' }],
  ['claude-fable-5-1', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-fable-5', { contextWindow: 500_000, tier: 'high' }],
  // DeepSeek V4 (preview): both variants 1,048,576.
  ['deepseek-v4-pro', { contextWindow: 1_048_576, tier: 'mid' }],
  ['deepseek-v4-flash', { contextWindow: 1_048_576, tier: 'mid' }],
  // Moonshot Kimi K3 (flagship, 1M); older Kimi generations are unsourced ->
  // no prefix, they resolve unknown and are override material.
  ['kimi-k3', { contextWindow: 1_000_000, tier: 'high' }],
  // Z.ai: GLM-5.3-Flash 1,048,576 (matches the 453k-prompt real session);
  // GLM-5 base model is 200K (covered by the prefix).
  ['glm5.3-flash', { contextWindow: 1_048_576, tier: 'low' }],
  ['glm-5.3-flash', { contextWindow: 1_048_576, tier: 'low' }],
  // Google: Gemini 3.1/4 = 1M (prefix below); Gemma 4 up to 256K.
  ['gemma4', { contextWindow: 256_000, tier: 'low' }],
  ['gemma-4', { contextWindow: 256_000, tier: 'low' }],
]);

/**
 * Ordered by specificity: the first matching rule wins. Prefixes are plain
 * startsWith checks on the lowercased name; a rule without the trailing dash
 * (e.g. `glm`) matches names that continue with a digit or letter. Prefix
 * values are the vendor's base-model windows; newer exact entries above
 * override them per name.
 */
const RULES: readonly CatalogRule[] = [
  // Claude: the 5.x generations declared 1M above; 4.x generations ship 500K
  // (Opus/Sonnet 4.6+) and Haiku 4.x stays at the safe 200K default.
  { prefix: 'claude-opus-', contextWindow: 500_000, tier: 'high' },
  { prefix: 'claude-sonnet-', contextWindow: 500_000, tier: 'mid' },
  { prefix: 'claude-haiku-', contextWindow: 200_000, tier: 'low' },
  { prefix: 'claude-fable-', contextWindow: 500_000, tier: 'high' },
  // OpenAI: the 5.5/5.6 and 6/6.1 families ship 1,050,000; gpt-5.1 (400K) is
  // pinned by the exact entry above.
  { prefix: 'gpt-6', contextWindow: 1_050_000, tier: 'high' },
  { prefix: 'gpt-5', contextWindow: 1_050_000, tier: 'high' },
  // DeepSeek: V4 declared 1,048,576 above; older generations keep 128K.
  { prefix: 'deepseek-', contextWindow: 128_000, tier: 'mid' },
  // Z.ai GLM-5 base model: 200K.
  { prefix: 'glm', contextWindow: 200_000, tier: 'mid' },
  // Google Gemini: 3.1/4 models share the 1M window.
  { prefix: 'gemini', contextWindow: 1_000_000, tier: 'high' },
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
