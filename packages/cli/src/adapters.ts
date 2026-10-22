import { createClaudeCodeAdapter } from '@runwire/adapter-claude-code';
import { createOpencodeAdapter } from '@runwire/adapter-opencode';
import { createGentleShellAdapter, createPiAdapter } from '@runwire/adapter-pi';
import type { HarnessAdapter } from '@runwire/core';

/** The registry of every harness adapter the CLI knows about (D76). */
export const adapters: HarnessAdapter[] = [
  createClaudeCodeAdapter(),
  createOpencodeAdapter(),
  createPiAdapter(),
  createGentleShellAdapter(),
];
