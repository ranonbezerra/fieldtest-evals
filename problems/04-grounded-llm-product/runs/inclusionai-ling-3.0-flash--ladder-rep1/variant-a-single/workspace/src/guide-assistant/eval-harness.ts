import { GroundingGate } from './grounding-gate.js';
import type { LLMClient } from './llm-client.interface.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldenScenario {
  name: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  falseFacts: string[];
  /** Scripted LLM response — so a confident lie can be planted. */
  scriptedLLMResponse: string;
  /** Whether the sources genuinely cover the question (for correct refusal scoring). */
  sourcesCoverQuestion: boolean;
}

export interface JudgeResult {
  score: number;
  details: string;
}

export interface EvalResult {
  finalAnswer: string;
  score: number;
  helpful: JudgeResult;
  faithful: JudgeResult;
}

// ---------------------------------------------------------------------------
// Helpfulness judge — receives the sources so it can tell a correct refusal
// from a harmful one.
// ---------------------------------------------------------------------------

export class HelpfulnessJudge {
  judge(answer: string, question: string, sources: string[]): JudgeResult {
    if (answer.includes('not covered by my sources')) {
      const covers = this.sourcesCoverQuestion(sources, question);
      if (covers) {
        return { score: 0, details: 'Refused even though sources contain the answer' };
      }
      return { score: 1, details: 'Correct refusal — sources do not cover the question' };
    }

    const relevance = this.measureRelevance(answer, question);
    return {
      score: relevance,
      details: relevance >= 0.5
        ? 'Answer addresses the question with relevant content'
        : 'Answer does not meaningfully address the question',
    };
  }

  /** Heuristic: do the sources contain content relevant to the question? */
  sourcesCoverQuestion(sources: string[], question: string): boolean {
    const combined = sources.join(' ').toLowerCase();
    const stopWords = new Set([
      'how', 'what', 'when', 'where', 'why', 'who', 'which', 'should', 'could',
      'would', 'the', 'and', 'for', 'are', 'was', 'were', 'been', 'have', 'has',
      'had', 'not', 'can', 'do', 'did', 'but', 'or', 'if', 'in', 'on', 'at',
      'to', 'of', 'by', 'with', 'from', 'is', 'it', 'this', 'that', 'you',
      'your', 'they', 'their', 'we', 'our', 'i', 'a', 'an', 'all', 'does',
    ]);
    const keyTerms = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));
    return keyTerms.some((term) => combined.includes(term));
  }

  private measureRelevance(answer: string, question: string): number {
    const answerWords = new Set(answer.toLowerCase().split(/\s+/));
    const questionTerms = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const matches = questionTerms.filter((w) => answerWords.has(w)).length;
    return matches / Math.max(questionTerms.length, 1);
  }
}

// ---------------------------------------------------------------------------
// Faithfulness judge — receives the sources.
// ---------------------------------------------------------------------------

export class FaithfulnessJudge {
  judge(answer: string, sources: string[]): JudgeResult {
    if (answer.includes('not covered by my sources')) {
      return { score: 1, details: 'Refusal is faithful to sources' };
    }

    const gate = new GroundingGate(sources);
    const allSentences = gate.splitSentences(answer);
    const supported = gate.gate(answer);

    if (allSentences.length === 0) {
      return { score: 1, details: 'Empty answer — no claims to verify' };
    }

    const ratio = supported.length / allSentences.length;
    if (ratio >= 1) {
      return { score: 1, details: 'All claims are grounded in sources' };
    }
    return {
      score: ratio,
      details: `${supported.length} of ${allSentences.length} sentences grounded in sources`,
    };
  }
}

// ---------------------------------------------------------------------------
// Eval harness — runs golden scenarios through both judges; final score = min.
// ---------------------------------------------------------------------------

export class EvalHarness {
  constructor(
    private readonly helpfulnessJudge: HelpfulnessJudge,
    private readonly faithfulnessJudge: FaithfulnessJudge,
  ) {}

  async evaluate(scenario: GoldenScenario, llm: LLMClient): Promise<EvalResult> {
    // Get the raw scripted LLM response (judges evaluate this)
    const rawAnswer = await llm.generate(scenario.question, scenario.sources, 'answer');

    // Apply grounding gate (production path) for the final answer
    const gate = new GroundingGate(scenario.sources);
    const supported = gate.gate(rawAnswer);
    const finalAnswer =
      supported.length > 0 ? supported.join(' ') : 'not covered by my sources';

    // Judges evaluate the RAW LLM output (not the post-gate version)
    const helpful = this.helpfulnessJudge.judge(rawAnswer, scenario.question, scenario.sources);
    const faithful = this.faithfulnessJudge.judge(rawAnswer, scenario.sources);

    return {
      finalAnswer,
      score: Math.min(helpful.score, faithful.score),
      helpful,
      faithful,
    };
  }
}
