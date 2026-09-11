import {
  checkProperNouns,
  checkQuantities,
  extractNumbers,
  splitSentences,
  vocabularyContainment,
} from './text-utils.js';

export interface SentenceVerdict {
  sentence: string;
  grounded: boolean;
  /** Why the sentence was dropped; empty when grounded. */
  reasons: string[];
}

export interface GateReport {
  verdicts: SentenceVerdict[];
  groundedSentences: string[];
  droppedSentences: string[];
}

export interface GroundingGateOptions {
  /** Minimum fraction of a sentence's content words that must appear in the sources (default 0.5). */
  minVocabularyContainment?: number;
}

/**
 * Sentence-level grounding gate on the production path. Each sentence of the
 * model's answer must be supported by the source texts or it is dropped.
 * A sentence is dropped when any of the following holds:
 *
 *  - a quantity claim ("5 shards") is not exactly supported by the sources,
 *  - it uses a number that appears nowhere in the sources,
 *  - it mentions a proper noun ("Dusk Caverns") the sources do not contain,
 *  - less than `minVocabularyContainment` of its content words are found in the sources.
 *
 * The checks are deliberately conservative: when in doubt, the sentence is dropped.
 */
export class GroundingGate {
  private readonly minContainment: number;

  constructor(options: GroundingGateOptions = {}) {
    this.minContainment = options.minVocabularyContainment ?? 0.5;
  }

  evaluate(answer: string, sources: string[]): GateReport {
    const sourceNumbers = new Set(sources.flatMap((s) => extractNumbers(s)));

    const verdicts: SentenceVerdict[] = splitSentences(answer).map((sentence) => {
      const reasons: string[] = [];

      for (const check of checkQuantities(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      for (const n of new Set(extractNumbers(sentence))) {
        if (!sourceNumbers.has(n)) reasons.push(`number ${n} does not appear in any source`);
      }
      for (const check of checkProperNouns(sentence, sources)) {
        if (!check.grounded && check.reason) reasons.push(check.reason);
      }
      const containment = vocabularyContainment(sentence, sources);
      if (containment < this.minContainment) {
        reasons.push(`only ${Math.round(containment * 100)}% of its vocabulary is found in the sources`);
      }

      return { sentence, grounded: reasons.length === 0, reasons };
    });

    return {
      verdicts,
      groundedSentences: verdicts.filter((v) => v.grounded).map((v) => v.sentence),
      droppedSentences: verdicts.filter((v) => !v.grounded).map((v) => v.sentence),
    };
  }
}
