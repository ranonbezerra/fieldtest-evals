import { isSentenceGrounded } from '../assistant/assistant.grounding';
// ASSUMPTION: assistant.service exports an Answer type representing the service's output shape
import type { Answer } from '../assistant/assistant.service';
// ASSUMPTION: eval.golden-scenarios exports a GoldenScenario interface with fields:
//   question: string; sources: string[]; expectedFacts: string[]; plantedFalseFacts: string[];
import type { GoldenScenario } from './eval.golden-scenarios';

export interface JudgeResult {
  score: number;
  reasons: string[];
}

export function helpfulnessJudge(answer: string, expectedFacts: string[]): JudgeResult {
  if (answer.trim() === '') {
    return { score: 0, reasons: ['Answer is empty'] };
  }

  const lowerAnswer = answer.toLowerCase();
  const covered = expectedFacts.filter((fact: string) =>
    lowerAnswer.includes(fact.toLowerCase()),
  );

  const score = expectedFacts.length === 0 ? 1 : covered.length / expectedFacts.length;
  const missing = expectedFacts.filter((fact: string) => !covered.includes(fact));

  return {
    score,
    reasons: missing.map((fact: string) => `Missing expected fact: "${fact}"`),
  };
}

export function faithfulnessJudge(answer: string, sources: string[]): JudgeResult {
  const sentences: string[] = answer
    .split(/(?<=[.!?])\s+/)
    .filter((s: string) => s.trim() !== '');

  if (sentences.length === 0) {
    return { score: 1, reasons: [] };
  }

  const ungrounded: string[] = sentences.filter(
    (sentence: string) => !isSentenceGrounded(sentence, sources),
  );

  const quantityIssues: string[] = detectQuantityErrors(sentences, sources);

  const totalIssues = ungrounded.length + quantityIssues.length;
  const score = totalIssues === 0 ? 1 : Math.max(0, 1 - totalIssues / sentences.length);

  const reasons: string[] = [
    ...ungrounded.map((s: string) => `Ungrounded sentence: "${s}"`),
    ...quantityIssues,
  ];

  return { score, reasons };
}

function detectQuantityErrors(sentences: string[], sources: string[]): string[] {
  const issues: string[] = [];
  const sourceText: string = sources.join(' ').toLowerCase();

  for (const sentence of sentences) {
    const numericMatches: RegExpMatchArray[] = [...sentence.matchAll(/(\d+)\s+(\w+)/g)];
    for (const match of numericMatches) {
      const num: string = match[1];
      const unit: string = match[2].toLowerCase();

      const sourcePattern: RegExp = new RegExp(`(\\d+)\\s+${unit}\\b`, 'gi');
      const sourceMatches: RegExpMatchArray[] = [...sourceText.matchAll(sourcePattern)];

      if (sourceMatches.length > 0 && !sourceMatches.some((m: RegExpMatchArray) => m[1] === num)) {
        const sourceNums: string[] = sourceMatches.map((m: RegExpMatchArray) => m[1]);
        issues.push(
          `Quantity error: answer says "${num} ${unit}" but sources indicate ${sourceNums.join(', ')} ${unit}`,
        );
      }
    }
  }

  return issues;
}

export function judgeScenario(scenario: GoldenScenario, answer: string): number {
  const helpfulness: JudgeResult = helpfulnessJudge(answer, scenario.expectedFacts);
  const faithfulness: JudgeResult = faithfulnessJudge(answer, scenario.sources);
  return Math.min(helpfulness.score, faithfulness.score);
}
