export type Confidence = 'high' | 'medium' | 'low';

/** Every number or label that came from source data carries its own provenance. */
export type Metric<T = number> = {
  value: T;
  confidence: Confidence;
  /** Machine-readable origin, e.g. "claude-code/assistant.usage#requestId". */
  source: string;
  /** Human-readable caveat, e.g. "derived: input - cached". */
  note?: string;
};

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The weakest of the given confidences (used when rolling up across contributors). */
export function minConfidence(confidences: readonly Confidence[]): Confidence {
  let min: Confidence = 'high';
  for (const c of confidences) {
    if (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[min]) min = c;
  }
  return min;
}
