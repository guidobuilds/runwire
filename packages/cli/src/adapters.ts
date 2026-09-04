import { createClaudeCodeAdapter } from '@scout/adapter-claude-code';
import type { HarnessAdapter } from '@scout/core';

/** The registry of every harness adapter the CLI knows about (D76). */
export const adapters: HarnessAdapter[] = [createClaudeCodeAdapter()];
