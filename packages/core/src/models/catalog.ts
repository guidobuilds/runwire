import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ModelTier = 'high' | 'mid' | 'low';

export type ModelCatalogEntry = {
  contextWindow: number | null;
  tier: ModelTier | null;
};

export type ModelOverride = {
  provider?: string;
  model: string;
  contextWindow: number;
};

type CatalogRule = {
  prefix: string;
} & ModelCatalogEntry;

const EXACT_PROVIDER_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  ['openai/gpt-6.1-sol', { contextWindow: 1_050_000, tier: 'high' }],
  ['openai/gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  ['anthropic/claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
]);

const EXACT_NAME_ENTRIES: ReadonlyMap<string, ModelCatalogEntry> = new Map([
  ['gpt-5.1', { contextWindow: 400_000, tier: 'high' }],
  ['claude-opus-5-5', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-opus-5', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-opus-4-7', { contextWindow: 500_000, tier: 'high' }],
  ['claude-sonnet-5-5', { contextWindow: 1_000_000, tier: 'mid' }],
  ['claude-sonnet-5', { contextWindow: 1_000_000, tier: 'mid' }],
  ['claude-haiku-5-5', { contextWindow: 1_000_000, tier: 'low' }],
  ['claude-fable-5-1', { contextWindow: 1_000_000, tier: 'high' }],
  ['claude-fable-5', { contextWindow: 500_000, tier: 'high' }],
  ['deepseek-v4-pro', { contextWindow: 1_048_576, tier: 'mid' }],
  ['deepseek-v4-flash', { contextWindow: 1_048_576, tier: 'mid' }],
  ['kimi-k3', { contextWindow: 1_000_000, tier: 'high' }],
  ['glm5.3-flash', { contextWindow: 1_048_576, tier: 'low' }],
  ['glm-5.3-flash', { contextWindow: 1_048_576, tier: 'low' }],
  ['gemma4', { contextWindow: 256_000, tier: 'low' }],
  ['gemma-4', { contextWindow: 256_000, tier: 'low' }],
]);

const RULES: readonly CatalogRule[] = [
  { prefix: 'claude-opus-', contextWindow: 500_000, tier: 'high' },
  { prefix: 'claude-sonnet-', contextWindow: 500_000, tier: 'mid' },
  { prefix: 'claude-haiku-', contextWindow: 200_000, tier: 'low' },
  { prefix: 'claude-fable-', contextWindow: 500_000, tier: 'high' },
  { prefix: 'gpt-6', contextWindow: 1_050_000, tier: 'high' },
  { prefix: 'gpt-5', contextWindow: 1_050_000, tier: 'high' },
  { prefix: 'deepseek-', contextWindow: 128_000, tier: 'mid' },
  { prefix: 'glm', contextWindow: 200_000, tier: 'mid' },
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

export function lookupModelCatalog(name: string): ModelCatalogEntry {
  return resolveModelCatalog(null, name);
}

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

export function readModelOverrides(path: string): ModelOverride[] {
  try {
    return parseModelOverrides(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
}

export function modelsOverridesPath(home: string): string {
  return join(home, '.runwire', 'models.json');
}
