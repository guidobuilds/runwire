/**
 * Model catalog: context window and capability tier by model-name prefix.
 *
 * This is configuration, not ground truth. A model that matches nothing
 * resolves to `null` for both fields; the consumer must then skip the
 * context-% drawing and exclude the model from tier-based rules. Users will
 * be able to override entries from Runwire settings later.
 */

export type ModelTier = 'high' | 'mid' | 'low';

export type ModelCatalogEntry = {
  /** Tokens. `null` when unknown — no context % is drawn for the model. */
  contextWindow: number | null;
  /** `null` when unknown — the model is excluded from tier-based detections. */
  tier: ModelTier | null;
};

type CatalogRule = {
  /** Case-insensitive prefix. A rule matches when the name starts with it. */
  prefix: string;
} & ModelCatalogEntry;

/**
 * Ordered by specificity: the first matching rule wins. Prefixes are plain
 * startsWith checks on the lowercased name; a rule without the trailing dash
 * (e.g. `glm`) matches names that continue with a digit or letter.
 */
const RULES: readonly CatalogRule[] = [
  // Claude: 1M-token betas exist for opus/sonnet; the safe default is 200k.
  { prefix: 'claude-opus-', contextWindow: 200_000, tier: 'high' },
  { prefix: 'claude-sonnet-', contextWindow: 200_000, tier: 'mid' },
  { prefix: 'claude-haiku-', contextWindow: 200_000, tier: 'low' },
  { prefix: 'gpt-6', contextWindow: 400_000, tier: 'high' },
  { prefix: 'gpt-5', contextWindow: 400_000, tier: 'high' },
  { prefix: 'deepseek-', contextWindow: 128_000, tier: 'mid' },
  { prefix: 'glm', contextWindow: 300_000, tier: 'low' },
];

const UNKNOWN: ModelCatalogEntry = { contextWindow: null, tier: null };

/** Resolve one model name against the catalog. Never throws; unknown names resolve to `null` fields. */
export function lookupModelCatalog(name: string): ModelCatalogEntry {
  const lower = name.toLowerCase();
  for (const rule of RULES) {
    if (lower.startsWith(rule.prefix)) {
      return { contextWindow: rule.contextWindow, tier: rule.tier };
    }
  }
  return UNKNOWN;
}
