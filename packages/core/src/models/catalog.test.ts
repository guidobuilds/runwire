import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lookupModelCatalog,
  modelsOverridesPath,
  readModelOverrides,
  resolveModelCatalog,
} from './catalog';

describe('resolveModelCatalog: provider/name cascade', () => {
  test('exact provider/model wins with the declared window', () => {
    expect(resolveModelCatalog('openai', 'gpt-6.1-sol')).toEqual({
      contextWindow: 1_050_000,
      tier: 'high',
    });
    expect(resolveModelCatalog('openai', 'gpt-5.1')).toEqual({
      contextWindow: 400_000,
      tier: 'high',
    });
    expect(resolveModelCatalog('anthropic', 'claude-sonnet-5-5')).toEqual({
      contextWindow: 1_000_000,
      tier: 'mid',
    });
  });

  test('exact name absorbs cross-harness provider variance (openai vs openai-codex)', () => {
    expect(resolveModelCatalog('openai-codex', 'gpt-6.1-sol')).toEqual({
      contextWindow: 1_050_000,
      tier: 'high',
    });
    expect(resolveModelCatalog('nan', 'gpt-6.1-sol')).toEqual({
      contextWindow: 1_050_000,
      tier: 'high',
    });
  });

  test('opus-5* resolves 1M by exact name (evidence: 877k prompts)', () => {
    expect(resolveModelCatalog(null, 'claude-opus-5-5')).toEqual({
      contextWindow: 1_000_000,
      tier: 'high',
    });
    expect(resolveModelCatalog(null, 'claude-opus-5')).toEqual({
      contextWindow: 1_000_000,
      tier: 'high',
    });
  });

  test('prefix rules still cover names without an exact entry', () => {
    expect(resolveModelCatalog('nan', 'deepseek-v4-flash')).toEqual({
      contextWindow: 128_000,
      tier: 'mid',
    });
    expect(resolveModelCatalog(null, 'claude-sonnet-5')).toEqual({
      contextWindow: 200_000,
      tier: 'mid',
    });
  });

  test('unknown models still resolve null/null', () => {
    expect(resolveModelCatalog('nan', 'totally-unknown-model')).toEqual({
      contextWindow: null,
      tier: null,
    });
  });

  test('overrides beat built-ins; provider-scoped beats name-only; NULL-provider models match name-only', () => {
    const overrides = [
      { provider: 'openai', model: 'gpt-6.1-sol', contextWindow: 500_000 },
      { model: 'gpt-6.1-sol', contextWindow: 600_000 },
      { model: 'claude-opus-5-5', contextWindow: 900_000 },
    ];
    expect(resolveModelCatalog('openai', 'gpt-6.1-sol', overrides)).toEqual({
      contextWindow: 500_000,
      tier: 'high',
    });
    expect(resolveModelCatalog('other-proxy', 'gpt-6.1-sol', overrides)).toEqual({
      contextWindow: 600_000,
      tier: 'high',
    });
    // claude-code style: NULL provider matches the name-only override.
    expect(resolveModelCatalog(null, 'claude-opus-5-5', overrides)).toEqual({
      contextWindow: 900_000,
      tier: 'high',
    });
    // Built-in still resolves names without an override.
    expect(resolveModelCatalog('openai', 'gpt-5.1', overrides)?.contextWindow).toBe(400_000);
  });

  test('matching is case-insensitive at every layer', () => {
    expect(resolveModelCatalog('OpenAI', 'GPT-6.1-SOL')?.contextWindow).toBe(1_050_000);
    expect(
      resolveModelCatalog('openai', 'gpt-6.1-sol', [
        { provider: 'openai', model: 'GPT-6.1-SOL', contextWindow: 1 },
      ])?.contextWindow,
    ).toBe(1);
  });
});

describe('model overrides file', () => {
  test('reads a list of objects and skips malformed entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runwire-ovr-'));
    const path = join(dir, 'models.json');
    writeFileSync(
      path,
      JSON.stringify([
        { provider: 'nan', model: 'deepseek-v4-flash', contextWindow: 128_000 },
        { model: 'gpt-5.1', contextWindow: 400_000 },
        { model: 'no-window' },
        { model: 'bad-window', contextWindow: 'lots' },
        'not-an-object',
      ]),
    );
    const overrides = readModelOverrides(path);
    expect(overrides).toEqual([
      { provider: 'nan', model: 'deepseek-v4-flash', contextWindow: 128_000 },
      { model: 'gpt-5.1', contextWindow: 400_000 },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing file, a malformed file or a non-list root resolve to no overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runwire-ovr-'));
    expect(readModelOverrides(join(dir, 'missing.json'))).toEqual([]);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(readModelOverrides(bad)).toEqual([]);
    const notList = join(dir, 'notlist.json');
    writeFileSync(notList, '{"openai/gpt-5.1": {"contextWindow": 400000}}');
    expect(readModelOverrides(notList)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('default path is ~/.runwire/models.json', () => {
    expect(modelsOverridesPath('/home/u')).toBe(join('/home/u', '.runwire', 'models.json'));
  });
});

describe('lookupModelCatalog', () => {
  test('known models resolve window and tier by prefix', () => {
    expect(lookupModelCatalog('claude-sonnet-5')).toEqual({
      contextWindow: 200_000,
      tier: 'mid',
    });
    expect(lookupModelCatalog('claude-haiku-4')).toEqual({
      contextWindow: 200_000,
      tier: 'low',
    });
  });

  test('exact entries declared by the user win over prefixes (S3)', () => {
    expect(lookupModelCatalog('gpt-6.1-sol')).toEqual({
      contextWindow: 1_050_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('claude-opus-5')).toEqual({
      contextWindow: 1_000_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('claude-opus-5-5')).toEqual({
      contextWindow: 1_000_000,
      tier: 'high',
    });
  });

  test('matches on the longest configured prefix, not the first', () => {
    expect(lookupModelCatalog('gpt-5.6-sol')).toEqual({
      contextWindow: 400_000,
      tier: 'high',
    });
    expect(lookupModelCatalog('gpt-5.1')).toEqual({
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
      contextWindow: 1_000_000,
      tier: 'high',
    });
  });
});
