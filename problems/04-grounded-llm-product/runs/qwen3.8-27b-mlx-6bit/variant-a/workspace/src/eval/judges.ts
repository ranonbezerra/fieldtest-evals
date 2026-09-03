import type { Source } from '../sources.js';

export interface JudgeVerdict {
  score: number;
  matched: string[];
  missed: string[];
}

export function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
): JudgeVerdict {
  const lowerAnswer = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  for (const fact of expectedFacts) {
    if (lowerAnswer.includes(fact.toLowerCase())) {
      matched.push(fact);
    } else {
      missed.push(fact);
    }
  }

  const score = expectedFacts.length === 0 ? 1 : matched.length / expectedFacts.length;
  return { score, matched, missed };
}

export function faithfulnessJudge(
  answer: string,
  sources: Source[],
  plantedFalseFacts: string[],
): JudgeVerdict {
  const lowerAnswer = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  let penalty = 0;

  // Check planted false facts
  for (const fact of plantedFalseFacts) {
    if (lowerAnswer.includes(fact.toLowerCase())) {
      missed.push(fact);
      penalty += 0.25;
    } else {
      matched.push(fact);
    }
  }

  // Check quantity consistency against sources
  const sourceTexts = sources.map((s) => s.text.toLowerCase());
  const quantityPattern = /(\d+)\s+([a-z][a-z]*)/g;
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = quantityPattern.exec(lowerAnswer)) !== null) {
    const count = parseInt(m[1], 10);
    const noun = m[2];
    const key = `${count}-${noun}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let hasConflict = false;
    for (const sourceText of sourceTexts) {
      const re = new RegExp(`(\\d+)\\s+${noun}\\b`, 'g');
      let sm: RegExpExecArray | null;
      while ((sm = re.exec(sourceText)) !== null) {
        const sourceCount = parseInt(sm[1], 10);
        if (sourceCount !== count) {
          hasConflict = true;
          break;
        }
      }
      if (hasConflict) break;
    }

    if (hasConflict) {
      missed.push(`${count} ${noun}`);
      penalty += 0.25;
    } else {
      matched.push(`${count} ${noun}`);
    }
  }

  const score = Math.max(0, 1 - penalty);
  return { score, matched, missed };
}
