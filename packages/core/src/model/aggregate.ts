import type { HarnessId } from './harness';
import type { ProjectRef } from './session';
import type { Usage } from './usage';

export type ProjectAggregate = {
  project: ProjectRef;
  /** Root sessions only (D2). */
  sessionCount: number;
  harnesses: HarnessId[];
  latestActivityAt?: string;
  /** Inclusive, summed across this project's root sessions. */
  aggregateUsage: Usage;
};

export type HarnessAggregate = {
  harness: HarnessId;
  sessionCount: number;
  /** Project keys. */
  projects: string[];
  latestActivityAt?: string;
  aggregateUsage: Usage;
};
