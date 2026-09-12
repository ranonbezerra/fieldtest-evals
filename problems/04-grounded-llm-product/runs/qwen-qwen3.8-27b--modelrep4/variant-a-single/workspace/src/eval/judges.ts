import { type AssistantAnswer } from '../assistant/assistant.service.js';
import {
  type SourceIndex,
  indexSources,
  isDigit,
  nextContent,
  properNouns,
  STOPWORDS,
  tokenize,
} from '../assistant/grounding.js';

export type ViolationType =
  | 'planted_false_fact'
  | 'quantity_mismatch'
  | 'unknown_quantity'
  | 'unknown_name'
  | 'missing_fact'
  | 'should_have_refused';

export interface Violation {
  type: ViolationType;
  detail: string;
  /** Exact count the answer stated (quantity violations only). */
  said?: string;
  /** Exact count the sources state (quantity_mismatch only). */
  sourceSays?: string;
  /** The term the count is about, e.g. "shards". */
  term?: string;
}

export interface JudgeReport {
  /** 1 = passes this judge cleanly, 0 = fails it completely. */
  score: number;
  violations: Violation[];
}

/** Two violations of any kind make the score 0. */
const VIOLATION_PENALTY = 0.5;
/** Share of a planted false fact's content words the answer must repeat. */
const PLANTED_ASSERTED_MIN = 0.6;
/** Share of an expected fact's content words the answer must cover. */
const FACT_COVERED_MIN = 0.7;

/**
 * Faithfulness judge. Receives the sources (plus the scenario's planted false
 * facts) and fails the answer if it asserts anything the sources do not state:
 * a contradictory count, a count the sources never give, a name the sources
 * never mention, or a planted false fact. A refusal asserts nothing, so it is
 * fully faithful.
 */
export function judgeFaithfulness(
  answer: AssistantAnswer,
  sources: string[],
  plantedFalseFacts: string[],
): JudgeReport {
  const violations: Violation[] = [];
  if (answer.status === 'answered') {
    const index = indexSources(sources);
    violations.push(...nameViolations(answer.text, index));
    violations.push(...quantityViolations(answer.text, index));
    for (const fact of plantedFalseFacts) {
      if (assertsPlantedFact(fact, answer.text)) {
        violations.push({
          type: 'planted_false_fact',
          detail: `answer asserts a planted false fact: "${fact}"`,
        });
      }
    }
  }
  return { score: Math.max(0, 1 - VIOLATION_PENALTY * violations.length), violations };
}

function nameViolations(text: string, index: SourceIndex): Violation[] {
  const out: Violation[] = [];
  for (const name of new Set(properNouns(text))) {
    if (!index.tokens.has(name)) {
      out.push({
        type: 'unknown_name',
        detail: `answer mentions "${name}" but no source page does`,
      });
    }
  }
  return out;
}

function quantityViolations(text: string, index: SourceIndex): Violation[] {
  const out: Violation[] = [];
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    if (!isDigit(tokens[i])) continue;
    const term = nextContent(tokens, i + 1);
    if (term === null) continue; // a bare number is not a quantity claim
    const known = index.counts.get(term);
    if (known !== undefined && known.has(tokens[i])) continue;
    if (known !== undefined && known.size > 0) {
      for (const sourceSays of known) {
        out.push({
          type: 'quantity_mismatch',
          said: tokens[i],
          sourceSays,
          term,
          detail: `answer says ${tokens[i]} ${term} but the sources say ${sourceSays} ${term}`,
        });
      }
    } else {
      out.push({
        type: 'unknown_quantity',
        said: tokens[i],
        term,
        detail: `answer claims ${tokens[i]} ${term} but the sources never state a count for it`,
      });
    }
  }
  return out;
}

function assertsPlantedFact(fact: string, answerText: string): boolean {
  const factTokens = tokenize(fact).filter((token) => !STOPWORDS.has(token));
  if (factTokens.length === 0) return false;
  const answerTokens = new Set(tokenize(answerText));
  // Every number in the false fact must appear in the answer...
  if (factTokens.filter(isDigit).some((n) => !answerTokens.has(n))) return false;
  // ...and most of its words must match the answer's wording.
  const present = factTokens.filter((token) => answerTokens.has(token)).length;
  return present / factTokens.length >= PLANTED_ASSERTED_MIN;
}

/**
 * Helpfulness judge. The answer must convey the scenario's expected facts;
 * for scenarios whose sources lack the answer, the helpful behaviour is the
 * refusal itself.
 */
export function judgeHelpfulness(
  answer: AssistantAnswer,
  expectations: { expectedFacts: string[]; expectedRefusal?: boolean },
): JudgeReport {
  if (expectations.expectedRefusal) {
    if (answer.status === 'refused') return { score: 1, violations: [] };
    return {
      score: 0,
      violations: [
        {
          type: 'should_have_refused',
          detail: 'the sources do not cover the answer, so the assistant should refuse',
        },
      ],
    };
  }

  const facts = expectations.expectedFacts;
  if (facts.length === 0) {
    if (answer.status === 'answered') return { score: 1, violations: [] };
    return {
      score: 0,
      violations: [{ type: 'missing_fact', detail: 'expected an answer but the assistant refused' }],
    };
  }

  const answerTokens = new Set(tokenize(answer.text));
  const violations: Violation[] = [];
  let covered = 0;
  for (const fact of facts) {
    const factTokens = tokenize(fact).filter((token) => !STOPWORDS.has(token));
    if (factTokens.length === 0) {
      covered += 1;
      continue;
    }
    const numbersOk = factTokens.filter(isDigit).every((n) => answerTokens.has(n));
    const present = factTokens.filter((token) => answerTokens.has(token)).length;
    if (numbersOk && present / factTokens.length >= FACT_COVERED_MIN) covered += 1;
    else violations.push({ type: 'missing_fact', detail: `expected fact not covered by the answer: "${fact}"` });
  }
  return { score: covered / facts.length, violations };
}
