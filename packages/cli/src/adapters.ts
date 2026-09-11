import { createClaudeCodeAdapter } from '@scout/adapter-claude-code';
import { createOpencodeAdapter } from '@scout/adapter-opencode';
import { createPiAdapter } from '@scout/adapter-pi';
import type { HarnessAdapter } from '@scout/core';

/** The registry of every harness adapter the CLI knows about (D76). */
export const adapters: HarnessAdapter[] = [
  createClaudeCodeAdapter(),
  createOpencodeAdapter(),
  createPiAdapter(),
];
