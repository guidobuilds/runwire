import type { HarnessId } from '@scout/core';
import claudeCode from './claude-code.svg?raw';
import codex from './codex.svg?raw';
import grok from './grok.svg?raw';
import opencode from './opencode.svg?raw';
import pi from './pi.svg?raw';

export const HARNESS_LOGO_MARKUP: Partial<Record<HarnessId, string>> = {
  'claude-code': claudeCode,
  codex,
  grok,
  opencode,
  pi,
};
