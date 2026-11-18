import { createClaudeCodeAdapter } from '@runwire/adapter-claude-code';
import { createOpencodeAdapter } from '@runwire/adapter-opencode';
import { createGentleShellAdapter, createPiAdapter } from '@runwire/adapter-pi';
import type { HarnessAdapter } from '@runwire/core';

export const adapters: HarnessAdapter[] = [
  createClaudeCodeAdapter(),
  createOpencodeAdapter(),
  createPiAdapter(),
  createGentleShellAdapter(),
];
