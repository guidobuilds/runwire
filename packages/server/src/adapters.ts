import { createClaudeCodeAdapter } from '@scout/adapter-claude-code';
import type { HarnessAdapter } from '@scout/core';

/**
 * The harness registry (docs/ARCHITECTURE.md §4): one line per harness.
 * M5 (Codex) adds a second entry here.
 */
export const adapters: HarnessAdapter[] = [createClaudeCodeAdapter()];
