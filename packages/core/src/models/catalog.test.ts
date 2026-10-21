import { describe, expect, test } from 'bun:test';
import { lookupModelCatalog } from './catalog';

describe('lookupModelCatalog', () => {
  test('known models resolve window and tier by prefix', () => {
    expect(lookupModelCatalog('claude-opus-5')).toEqual({
      contextWindow: 200_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('claude-opus-5-5')).toEqual({
      contextWindow: 200_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('claude-sonnet-5')).toEqual({
      contextWindow: 200_000,
      tier: 'mid',
    });
    expect(lookupModelCatalog('claude-haiku-4')).toEqual({
      contextWindow: 200_000,
      tier: 'low',
    });
  });

  test('matches on the longest configured prefix, not the first', () => {
    expect(lookupModelCatalog('gpt-5.6-sol')).toEqual({
      contextWindow: 400_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('gpt-6.1-sol')).toEqual({
      contextWindow: 400_000,
      tier: 'high',
    });
  });

  test('matches prefixes without a trailing dash in the config', () => {
    expect(lookupModelCatalog('glm5.3-flash')).toEqual({
      contextWindow: 300_000,
      tier: 'low',
    });
    expect(lookupModelCatalog('deepseek-v4-pro')).toEqual({
      contextWindow: 128_000,
      tier: 'mid',
    });
  });

  test('prefix matching does not cross into unrelated names', () => {
    // 'claude-opus' must not match 'claude-opusx' or 'myclaude-opus-5'.
    expect(lookupModelCatalog('claude-opusx-5').tier).toBeNull();
    expect(lookupModelCatalog('myclaude-opus-5').tier).toBeNull();
    expect(lookupModelCatalog('gptx-5').tier).toBeNull();
  });

  test('unknown models return null window and null tier', () => {
    expect(lookupModelCatalog('mystery-model-v9')).toEqual({
      contextWindow: null,
      tier: null,
    });
    expect(lookupModelCatalog('')).toEqual({ contextWindow: null, tier: null });
  });

  test('matching is case-insensitive on the model name', () => {
    expect(lookupModelCatalog('Claude-Opus-5')).toEqual({
      contextWindow: 200_000,
      tier: 'high',
    });
  });
});
