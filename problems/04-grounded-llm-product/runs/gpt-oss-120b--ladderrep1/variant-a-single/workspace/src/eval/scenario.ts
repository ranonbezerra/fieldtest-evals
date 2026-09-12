export interface Scenario {
  /** Human‑readable identifier (useful for debugging). */
  id: string;
  /** Player question. */
  question: string;
  /** Wiki page texts that are considered the only truth source. */
  sources: string[];
  /** Facts that a correct answer must contain (exact substrings). */
  expectedFacts: string[];
  /** Facts that must **not** appear in a correct answer (invented or wrong). */
  falseFacts: string[];
  /** Optional mode to force the service into hint mode for this scenario. */
  mode?: 'full' | 'hint';
}
