import type { LaneModelData } from '../model';
import { compactions } from './compactions';
import { context } from './context';
import { failures } from './failures';
import { idle } from './idle';
import { mcp } from './mcp';
import { modelChanges } from './model-changes';
import { skills } from './skills';
import { subagents } from './subagents';

export type Indicator = {
  id: string;
  name: string;
  colorToken: string;
  shape: 'series' | 'mark' | 'connector' | 'vertical' | 'dashed-line' | 'axis-cut';
  count(model: LaneModelData): number;
};

export const indicators: readonly Indicator[] = [
  {
    id: 'context',
    name: 'Context %',
    colorToken: '--lane-context',
    shape: 'series',
    count: (m) => context(m).filter((p) => p.value !== null).length,
  },
  {
    id: 'subagents',
    name: 'Subagent calls',
    colorToken: '--lane-kind-agent',
    shape: 'connector',
    count: (m) => subagents(m).reduce((n, p) => n + p.count, 0),
  },
  {
    id: 'skills',
    name: 'Skills',
    colorToken: '--lane-skill',
    shape: 'mark',
    count: (m) => skills(m).reduce((n, p) => n + p.count, 0),
  },
  {
    id: 'mcp',
    name: 'MCP calls',
    colorToken: '--lane-kind-mcp',
    shape: 'mark',
    count: (m) => mcp(m).reduce((n, p) => n + p.count, 0),
  },
  {
    id: 'compactions',
    name: 'Compactions',
    colorToken: '--lane-compaction',
    shape: 'vertical',
    count: (m) => compactions(m).length,
  },
  {
    id: 'model-changes',
    name: 'Model changes',
    colorToken: '--lane-tier-high',
    shape: 'dashed-line',
    count: (m) => modelChanges(m).length,
  },
  {
    id: 'failures',
    name: 'Failures',
    colorToken: '--lane-failure',
    shape: 'mark',
    count: (m) => failures(m).reduce((n, p) => n + p.count, 0),
  },
  {
    id: 'idle',
    name: 'Idle gaps',
    colorToken: '--lane-idle',
    shape: 'axis-cut',
    count: (m) => idle(m).length,
  },
];
