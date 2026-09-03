# 07-judges.ts

## reasoning

```
Let me analyze what `src/eval/judges.ts` needs to contain based on the PLAN.md specification.

From the plan:

```ts
export interface JudgeVerdict {
  score: number;   // 0..1
  matched: string[];
  missed: string[];
}

/** Checks that every `expectedFact` appears (case-insensitive) in `answer`. */
export declare function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
): JudgeVerdict;

/**
 * Checks that no `plantedFalseFact` appears in `answer`, AND that every
 * quantity claim in `answer` is consistent with `sources`.
 * A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as
 * a violation and reduces the score.
 */
export declare function faithfulnessJudge(
  answer: string,
  sources: Source[],
  plantedFalseFacts: string[],
): JudgeVerdict;
```

Now let me think about the implementation:

**helpfulnessJudge:**
- For each `expectedFact`, check if it appears (case-insensitive) in `answer`.
- `matched` = facts that were found.
- `missed` = facts that were not found.
- `score` = matched.length / expectedFacts.length (0 if empty array).

**faithfulnessJudge:**
- Check that no `plantedFalseFact` appears in `answer` (case-insensitive).
- Check that every quantity claim in `answer` is consistent with `sources`.
- A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as a violation.

For the faithfulness judge, I need to:
1. Check for planted false facts - if any appear, that's a violation.
2. Check quantity claims: extract patterns like "N <noun>" from the answer, and verify that the same noun in sources has the same number.

Let me think about the quantity extraction. The plan says "every quantity claim in `answer` is consistent with `sources`". So I need to:
- Extract quantity+unit pairs from the answer (e.g., "5 shards")
- For each such pair, check if the sources contain the same unit with a different quantity.

The regex for quantities would be something like: `\b(\d+)\s+([a-z]+)\b` (case-insensitive).

For each quantity claim found in the answer, I check if any source contains the same noun with a different number. If so, that's a violation.

Actually, let me think more carefully. The plan says "every quantity claim in `answer` is consistent with `sources`". This means:
- For each "N unit" in the answer, check if sources mention "M unit" where M ≠ N. If they do, that's a mismatch.

But what if the sources don't mention that unit at all? Then it's not a quantity mismatch (that would be an ungrounded fact, but the grounding gate handles that).

Wait, actually re-reading: "A quantity mismatch (e.g. "5 shards" vs source "4 shards") counts as a violation and reduces the score."

So the logic is:
1. Extract all "N unit" patterns from the answer.
2. For each, search sources for the same unit with a number.
3. If found and the numbers differ → violation.

For scoring:
- Start with score = 1.0
- For each violation (planted false fact found, or quantity mismatch), reduce the score.

How to reduce? Let me think about what makes sense:
- For planted false facts: each one found is a violation.
- For quantity mismatches: each one is a violation.

A reasonable approach: 
- Total checks = plantedFalseFacts.length + (number of quantity claims that have a corresponding source quantity)
- Violations = number of planted false facts found + number of quantity mismatches
- score = 1 - (violations / totalChecks), clamped to [0, 1]

Wait, but what if there are no checks at all (no planted false facts and no quantity claims with source counterparts)? Then score should be 1.0.

Actually, let me reconsider. The plan says the score is 0..1. Let me think about what `matched` and `missed` mean for the faithfulness judge.

For faithfulness:
- `matched` could be the checks that passed (no violation)
- `missed` could be the violations found

Let me structure it:
- Checks that can fail:
  - Each plantedFalseFact that appears in answer → violation
  - Each quantity claim in answer that conflicts with sources → violation
- Checks that pass:
  - Each plantedFalseFact that does NOT appear in answer → match
  - Each quantity claim that IS consistent → match

So:
- total checks = plantedFalseFacts.length + quantityClaimsWithSourceCounterpart
- violations = falseFactsFound + quantityMismatches
- score = (totalChecks - violations) / totalChecks, or 1.0 if totalChecks === 0

`matched` = list of things that passed (descriptions)
`missed` = list of things that failed (descriptions)

Hmm, but what should `matched` and `missed` contain? For helpfulnessJudge it's the facts themselves. For faithfulness, I'll use descriptive strings.

Let me write the implementation:

```ts
import { Source } from "../sources";

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
```

For faithfulnessJudge, I need to extract quantity claims. Let me use a regex: `/\b(\d+)\s+([a-zA-Z]+)\b/g`

Then for each match, check if any source contains the same word with a different number.

```ts
export function faithfulnessJudge(
  answer: string,
  sources: Source[],
  plantedFalseFacts: string[],
): JudgeVerdict {
  const lowerAnswer = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];

  // Check planted false facts
  for (const fact of plantedFalseFacts) {
    if (lowerAnswer.includes(fact.toLowerCase())) {
      missed.push(`contains false fact: "${fact}"`);
    } else {
      matched.push(`absent false fact: "${fact}"`);
    }
  }

  // Check quantity claims
  const quantityRegex = /\b(\d+)\s+([a-z]+)\b/g;
  const sourceText = sources.map(s => s.text.toLowerCase()).join(" ");
  
  let match: RegExpExecArray | null;
  const qtyMatches: { num: number; unit: string }[] = [];
  
  while ((match = quantityRegex.exec(answer)) !== null) {
    qtyMatches.push({ num: parseInt(match[1], 10), unit: match[2].toLowerCase() });
  }

  for (const claim of qtyMatches) {
    // Find if any source mentions the same unit with a number
    const sourcePattern = new RegExp(`\\b(\\d+)\\s+${escapeRegex(claim.unit)}\\b`, "i");
    let sourceMatch: RegExpExecArray | null;
    let foundInSource = false;
    let mismatch = false;
    
    for (const src of sources) {
      sourceMatch = sourcePattern.exec(src.text);
      if (sourceMatch) {
        foundInSource = true;
        const sourceNum = parseInt(sourceMatch[1], 10);
        if (sourceNum !== claim.num) {
          mismatch = true;
          missed.push(`quantity mismatch: answer says "${claim.num} ${claim.unit}", source says "${sourceNum} ${claim.unit}"`);
        } else {
          matched.push(`quantity consistent: "${claim.num} ${claim.unit}"`);
        }
      }
    }
    
    if (foundInSource && !mismatch) {
      // already added to matched above
    }
  }

  const totalChecks = plantedFalseFacts.length + qtyMatches.length;
  // Hmm, this doesn't quite work because a quantity claim might not have a source counterpart.
  
  // Let me reconsider...
}
```

Wait, I need to be more careful. If a quantity claim in the answer has NO corresponding mention in any source, should that count? The plan says "every quantity claim in `answer` is consistent with `sources`". If there's no source mention, it's not inconsistent - it's just ungrounded (which the grounding gate handles separately). So I'll only count quantity claims that have a source counterpart.

Let me also think about edge cases:
- What if the same unit appears multiple times in sources with different numbers? I'll check against all and flag any mismatch.

Actually, let me simplify. For each quantity claim in the answer:
- Search all sources for the same unit preceded by a number.
- If found and ANY source has a different number → violation.
- If found and ALL sources have the same number → pass.
- If not found in any source → skip (not a faithfulness issue).

Let me also handle the case where `qtyMatches` is empty and `plantedFalseFacts` is empty → score = 1.

Let me refine:

```ts
import { Source } from "../sources";

export interface JudgeVerdict {
  score: number;
  matched: string[];
  missed: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  // Check planted false facts
  for (const fact of plantedFalseFacts) {
    if (lowerAnswer.includes(fact.toLowerCase())) {
      missed.push(`contains false fact: "${fact}"`);
    } else {
      matched.push(`absent false fact: "${fact}"`);
    }
  }

  // Extract quantity claims from answer
  const qtyRegex = /\b(\d+)\s+([a-zA-Z]+)\b/g;
  const qtyClaims: { num: number; unit: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = qtyRegex.exec(answer)) !== null) {
    qtyClaims.push({ num: parseInt(m[1], 10), unit: m[2].toLowerCase() });
  }

  // For each quantity claim, check against sources
  for (const claim of qtyClaims) {
    const srcPattern = new RegExp(`\\b(\\d+)\\s+${escapeRegex(claim.unit)}\\b`, "i");
    let hasSourceCounterpart = false;
    let isMismatch = false;

    for (const src of sources) {
      const sm = srcPattern.exec(src.text);
      if (sm !== null) {
        hasSourceCounterpart = true;
        const srcNum = parseInt(sm[1], 10);
        if (srcNum !== claim.num) {
          isMismatch = true;
          missed.push(`quantity mismatch: answer says "${claim.num} ${claim.unit}", source says "${srcNum} ${claim.unit}"`);
        }
      }
    }

    if (hasSourceCounterpart && !isMismatch) {
      matched.push(`quantity consistent: "${claim.num} ${claim.unit}"`);
    }
  }

  const totalChecks = plantedFalseFacts.length + qtyClaims.filter(/* has source counterpart */).length;
  
  // Hmm, I'm computing this wrong. Let me count differently.
}
```

Actually, let me think about the score calculation differently. 

The total number of "checks" that can pass or fail:
- Each planted false fact is one check (pass = absent, fail = present)
- Each quantity claim that has a source counterpart is one check (pass = consistent, fail = mismatch)

Score = passed / totalChecks, or 1.0 if no checks.

Let me track this with a counter:

```ts
let totalChecks = 0;
let passed = 0;
```

For each planted false fact: totalChecks++, if absent then passed++.
For each quantity claim with source counterpart: totalChecks++, if consistent then passed++.

score = totalChecks === 0 ? 1 : passed / totalChecks;

Let me write the final version:

```ts
import { Source } from "../sources";

export interface JudgeVerdict {
  score: number;
  matched: string[];
  missed: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let totalChecks = 0;
  let passedChecks = 0;

  // Check planted false facts
  for (const fact of plantedFalseFacts) {
    totalChecks++;
    if (lowerAnswer.includes(fact.toLowerCase())) {
      missed.push(`contains false fact: "${fact}"`);
    } else {
      passedChecks++;
      matched.push(`absent false fact: "${fact}"`);
    }
  }

  // Extract quantity claims from answer
  const qtyRegex = /\b(\d+)\s+([a-zA-Z]+)\b/g;
  const qtyClaims: { num: number; unit: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = qtyRegex.exec(answer)) !== null) {
    qtyClaims.push({ num: parseInt(m[1], 10), unit: m[2].toLowerCase() });
  }

  // For each quantity claim, check against sources
  for (const claim of qtyClaims) {
    const srcPattern = new RegExp(`\\b(\\d+)\\s+${escapeRegex(claim.unit)}\\b`, "i");
    let hasSourceCounterpart = false;
    let isMismatch = false;

    for (const src of sources) {
      const sm = srcPattern.exec(src.text);
      if (sm !== null) {
        hasSourceCounterpart = true;
        const srcNum = parseInt(sm[1], 10);
        if (srcNum !== claim.num) {
          isMismatch = true;
          missed.push(`quantity mismatch: answer says "${claim.num} ${claim.unit}", source says "${srcNum} ${claim.unit}"`);
        }
      }
    }

    if (hasSourceCounterpart) {
      totalChecks++;
      if (!isMismatch) {
        passedChecks++;
        matched.push(`quantity consistent: "${claim.num} ${claim.unit}"`);
      }
    }
  }

  const score = totalChecks === 0 ? 1 : passedChecks / totalChecks;

  return { score, matched, missed };
}
```

Wait, I need to double-check: the plan says this file "reads: src/sources.ts". So I import `Source` from `"../sources"`. The file is at `src/eval/judges.ts` and `Source` is at `src/sources.ts`, so the import path is `"../sources"`.

Let me also verify: the plan says the file exports `JudgeVerdict`, `helpfulnessJudge`, and `faithfulnessJudge`. I should not add anything else.

One thing I want to verify - the `escapeRegex` helper. Is it okay to have a non-exported helper function? The plan says "Do not add an export, a feature or a file the plan does not name." A private helper function isn't an export, so it should be fine.

I think this implementation is solid. Let me finalize it.
```

## reply

```ts
import { Source } from "../sources";

export interface JudgeVerdict {
  score: number;
  matched: string[];
  missed: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let totalChecks = 0;
  let passedChecks = 0;

  for (const fact of plantedFalseFacts) {
    totalChecks++;
    if (lowerAnswer.includes(fact.toLowerCase())) {
      missed.push(`contains false fact: "${fact}"`);
    } else {
      passedChecks++;
      matched.push(`absent false fact: "${fact}"`);
    }
  }

  const qtyRegex = /\b(\d+)\s+([a-zA-Z]+)\b/g;
  const qtyClaims: { num: number; unit: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = qtyRegex.exec(answer)) !== null) {
    qtyClaims.push({ num: parseInt(m[1], 10), unit: m[2].toLowerCase() });
  }

  for (const claim of qtyClaims) {
    const srcPattern = new RegExp(`\\b(\\d+)\\s+${escapeRegex(claim.unit)}\\b`, "i");
    let hasSourceCounterpart = false;
    let isMismatch = false;

    for (const src of sources) {
      const sm = srcPattern.exec(src.text);
      if (sm !== null) {
        hasSourceCounterpart = true;
        const srcNum = parseInt(sm[1], 10);
        if (srcNum !== claim.num) {
          isMismatch = true;
          missed.push(
            `quantity mismatch: answer says "${claim.num} ${claim.unit}", source says "${srcNum} ${claim.unit}"`,
          );
        }
      }
    }

    if (hasSourceCounterpart) {
      totalChecks++;
      if (!isMismatch) {
        passedChecks++;
        matched.push(`quantity consistent: "${claim.num} ${claim.unit}"`);
      }
    }
  }

  const score = totalChecks === 0 ? 1 : passedChecks / totalChecks;

  return { score, matched, missed };
}
```
