# repair2-judges.ts

## reasoning

```
The compiler error for `src/eval/judges.ts` is:

```
src/eval/judges.ts(1,24): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../sources.js'?
```

So the fix is simple: change the import from `../sources` to `../sources.js`.

Now I need to write the complete file. Let me think about what `judges.ts` needs based on the PLAN:

1. `JudgeVerdict` interface with `score`, `matched`, `missed`
2. `helpfulnessJudge(answer, expectedFacts)` - checks every expectedFact appears case-insensitive in answer
3. `faithfulnessJudge(answer, sources, plantedFalseFacts)` - checks no plantedFalseFact appears AND quantity claims are consistent with sources

For the faithfulness judge, I need to:
- Check that no plantedFalseFact substring appears in the answer (case-insensitive)
- Extract quantity claims from the answer (e.g., "5 shards") and verify them against the sources
- A quantity mismatch counts as a violation

Let me think about how to implement the quantity checking. I need to extract patterns like "N <noun>" from the answer and check if the sources contain a different number for the same noun.

A reasonable approach:
1. Find all `<number> <word(s)>` patterns in the answer (e.g., "5 shards")
2. For each, find if any source mentions the same noun(s) with a different number
3. If so, it's a violation

Let me think about the scoring:
- `helpfulnessJudge`: score = matched / expectedFacts.length (0 if no expected facts)
- `faithfulnessJudge`: starts at 1.0, reduced by violations. Each plantedFalseFact found reduces score. Each quantity mismatch reduces score.

Actually, let me think more carefully. The score should be 0..1. Let me design it as:

For `helpfulnessJudge`:
- For each expectedFact, check if it appears (case-insensitive) in answer
- score = number matched / total expected facts
- matched = list of facts that were found
- missed = list of facts that weren't found

For `faithfulnessJudge`:
- Violations: each plantedFalseFact found in answer, each quantity mismatch
- If no violations, score = 1.0
- If violations exist, score decreases proportionally

Let me think about how to count violations for faithfulness. A simple approach:
- Count total potential violations = plantedFalseFacts.length + quantityClaims.length (where quantityClaims are extracted from the answer)
- Actually, that's complex. Let me think differently.

A simpler approach: 
- Start with a penalty of 0
- For each plantedFalseFact found in the answer: penalty += 0.5 (or some weight)
- For each quantity mismatch: penalty += 0.5
- score = max(0, 1 - totalPenalty)

But the plan says "A quantity mismatch (e.g. '5 shards' vs source '4 shards') counts as a violation and reduces the score." So it should reduce the score but the exact formula isn't specified. Let me use a simple approach:

- Count violations (each plantedFalseFact found + each quantity mismatch)
- score = max(0, 1 - violations * 0.25) — this way 4 violations = 0

Actually, let me keep it simpler and more testable:
- For plantedFalseFacts: if any are found, that's bad. Let's say each one reduces by 0.25.
- For quantity mismatches: each one reduces by 0.25.
- score = max(0, 1 - totalPenalty)

Wait, but the tests need:
- A confident-lie (contains planted false fact) → finalScore < 0.8
- A correct grounded answer → finalScore >= 0.8
- Quantity error "5 shards" when source says "4" → faithfulnessScore < 0.8

So if a planted false fact is found, faithfulness should drop below 0.8. If score starts at 1.0 and one violation drops it by 0.25, we get 0.75 which is < 0.8. Good.

If quantity mismatch: same, drops to 0.75 < 0.8. Good.

If correct answer: no violations, score = 1.0 >= 0.8. Good.

Let me go with: each violation reduces score by 0.25, minimum 0.

Now for extracting quantity claims from the answer:
- Pattern: `(\d+)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)` — but this is tricky because we need to match the noun phrase.

Actually, a simpler approach: find patterns like `(\d+)\s+(\w+)` in the answer (number followed by a word), then check if any source has a different number before the same word.

Let me be more precise. I'll look for patterns like `(\d+)\s+([a-z]+)` (lowercase word after number) in the answer. Then for each such match, I check if any source contains a pattern `(\d+)\s+same_word` where the number is different.

This should catch "5 shards" vs "4 shards" in the source.

Let me write this:

```typescript
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

  // Check quantity consistency
  const sourceTexts = sources.map(s => s.text.toLowerCase());
  const quantityPattern = /(\d+)\s+([a-z][a-z]*)/g;
  const answerQuantities: { count: number; noun: string }[] = [];

  let m;
  const answerLower = answer.toLowerCase();
  while ((m = quantityPattern.exec(answerLower)) !== null) {
    answerQuantities.push({ count: parseInt(m[1], 10), noun: m[2] });
  }

  for (const { count, noun } of answerQuantities) {
    for (const sourceText of sourceTexts) {
      const re = new RegExp(`(\\d+)\\s+${noun}\\b`, 'g');
      let sm;
      while ((sm = re.exec(sourceText)) !== null) {
        const sourceCount = parseInt(sm[1], 10);
        if (sourceCount !== count) {
          missed.push(`${count} ${noun} (sources say ${sourceCount} ${noun})`);
          penalty += 0.25;
        }
      }
    }
  }

  const score = Math.max(0, 1 - penalty);
  return { score, matched, missed };
}
```

Wait, I need to be careful. The `matched` and `missed` fields in the faithfulness judge are a bit awkward. For planted false facts, "matched" means the false fact was NOT found (good), and "missed" means it WAS found (bad). That's confusing. Let me reconsider.

Actually, looking at the interface again:
```
export interface JudgeVerdict {
  score: number;   // 0..1
  matched: string[];
  missed: string[];
}
```

For helpfulness: matched = facts that were found (good), missed = facts not found (bad)
For faithfulness: matched = checks that passed, missed = violations found

I think for faithfulness, "matched" could mean "things that passed the faithfulness check" and "missed" means "violations detected". That works.

Actually, let me reconsider. For faithfulness, maybe:
- `matched` = plantedFalseFacts that were correctly absent (good) + quantity claims that matched sources
- `missed` = plantedFalseFacts that were present (bad) + quantity mismatches

Let me simplify and just track violations in `missed` and passes in `matched`.

Let me also reconsider the quantity matching. I should be careful not to double-count. If "5 shards" appears and the source says "4 shards", I should only count one violation, not one per source that mentions "shards".

Let me refine: for each quantity claim in the answer, check ALL sources. If ANY source has a different number for that noun, it's a mismatch. But I should only count it once per unique (count, noun) pair.

Actually, let me simplify: for each unique (count, noun) in the answer, check if there's a conflict with any source. One mismatch per unique claim.

Let me rewrite:

```typescript
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

  // Check quantity consistency
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
```

This looks good. The only compiler fix needed is adding `.js` to the import path. Let me verify that's the only error for this file — yes, line 1 column 24 is the import statement.

Let me finalize the file.
```

## reply

```typescript
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
```
