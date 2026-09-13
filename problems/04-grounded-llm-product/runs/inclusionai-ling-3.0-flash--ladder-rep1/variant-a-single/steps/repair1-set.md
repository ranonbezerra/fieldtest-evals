# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/guide-assistant/answer.service.ts(1,32)`: Cannot find module './llm-client.interface' - needs `.js` extension
2. `src/guide-assistant/answer.service.ts(2,31)`: './grounding-gate' needs `.js` extension
3. `src/guide-assistant/answer.service.ts(3,47)`: './hint-mode' needs `.js` extension
4. `src/guide-assistant/eval-harness.ts(1,31)`: './grounding-gate' needs `.js` extension
5. `src/guide-assistant/eval-harness.ts(2,32)`: './llm-client.interface' needs `.js` extension (or it's a missing file)
6. `src/guide-assistant/scenarios.ts(1,37)`: './eval-harness' needs `.js` extension

The pattern is clear: all relative imports need explicit `.js` extensions due to `moduleResolution: node16/nodenext`. And there's a missing `llm-client.interface` file - but since the task says "fix all of them", and the error is "Cannot find module", I need to check if the file exists or if I need to create it.

Wait - the error for `./llm-client.interface` is TS2307 (Cannot find module) while others are TS2835 (needs explicit file extensions). So the `.js` extension fix might resolve the TS2307 errors too, since the file might actually be `llm-client.interface.ts` or `llm-client.interface.js`.

Actually, looking more carefully: the TS2307 error says "Cannot find module './llm-client.interface' or its corresponding type declarations." This could mean the file doesn't exist, OR it means TypeScript can't resolve it because it needs the extension. Since the other imports need `.js` extensions, this one likely needs `./llm-client.interface.js` as well.

But wait - the TS2307 is different from TS2835. The TS2835 errors specifically say "Relative import paths need explicit file extensions" and suggest adding `.js`. The TS2307 just says "Cannot find module". This could mean the file genuinely doesn't exist.

Let me check what files are referenced:
- `llm-client.interface` - used in answer.service.ts and eval-harness.ts
- `grounding-gate` - used in answer.service.ts and eval-harness.ts
- `hint-mode` - used in answer.service.ts

Since the task says to fix all errors and the `llm-client.interface` file seems to be referenced but missing, I likely need to create it. But actually, the instructions say "Do not add features" and "Do not create a file it does not call for". The `llm-client.interface` is clearly called for by multiple files that import it.

Let me think about this differently. The error says "Cannot find module './llm-client.interface'". With node16 moduleResolution, TypeScript needs the explicit extension. If I change it to `./llm-client.interface.js`, it should resolve (assuming the file exists as `.ts`).

Actually, in ESM with `type: "module"`, TypeScript compiles `.ts` to `.js`, so imports use `.js` extensions. The file on disk is `llm-client.interface.ts` but the import should be `./llm-client.interface.js`.

So the fix for the TS2307 errors on `llm-client.interface` is likely to add `.js` extension too.

But wait - the TS2307 is specifically "Cannot find module... or its corresponding type declarations". If the file existed as `llm-client.interface.ts`, TypeScript with node16 resolution would look for it. The issue is that without the extension, it can't find it. Adding `.js` should fix it.

So all fixes are adding `.js` extensions. Let me apply that:

1. `answer.service.ts`: `./llm-client.interface` → `./llm-client.interface.js`, `./grounding-gate` → `./grounding-gate.js`, `./hint-mode` → `./hint-mode.js`
2. `eval-harness.ts`: `./grounding-gate` → `./grounding-gate.js`, `./llm-client.interface` → `./llm-client.interface.js`
3. `scenarios.ts`: `./eval-harness` → `./eval-harness.js`

That's it - one distinct mistake (missing `.js` extensions) applied consistently.

But wait, the TS2307 for `llm-client.interface` is different from TS2835. Let me reconsider. Maybe the file `llm-client.interface.ts` doesn't exist and needs to be created? The instructions say "fix all of them" and the errors include this one.

Hmm, but the task also says "Do not create a file it does not call for". The file IS called for - it's imported by two files. So I might need to create it.

Actually, let me re-read: "Do not add features, do not rename anything the errors do not mention, do not reorganise." Creating a missing interface file that's imported by existing code is fixing a bug, not adding a feature.

But I don't know what's in `llm-client.interface`. Let me check the reference material... In the eval-harness.ts, it's imported as `import type { LLMClient } from './llm-client.interface';` and in answer.service.ts similarly. So it defines a `LLMClient` type/interface.

Looking at how it's used:
- `llm.generate(question, sources, mode)` in answer.service.ts
- `llm.generate(scenario.question, scenario.sources, 'answer')` in eval-harness.ts

So the interface likely has a `generate` method.

Let me create the interface file with `.js` extension and also fix all other imports.

Wait, but the instructions say "Return only the files you changed" and "A file you did not need to touch must not appear." If I need to create `llm-client.interface.ts`, that's a new file. Let me check if that's appropriate.

The error TS2307 "Cannot find module" could be fixed by either:
1. Adding `.js` extension to the import
2. Creating the missing file

Since other TS2835 errors explicitly suggest adding `.js`, and the TS2307 for the same module suggests the same thing, I think adding `.js` is the correct fix. TypeScript with node16 resolution would look for `./llm-client.interface.js` which would resolve to the compiled output of `llm-client.interface.ts`.

But if the source file doesn't exist at all, neither fix works. Given that this is a "fix all errors" task and the file is imported by two places, I think the file likely exists but the import path is wrong. Let me go with adding `.js` to all imports.

Actually, I just realized: the TS2307 error for `llm-client.interface` doesn't have the "Did you mean './llm-client.interface.js'?" suggestion that the TS2835 errors have. This is suspicious. It might mean the file genuinely doesn't exist.

But I'm told to fix the errors. If the file doesn't exist, I need to create it. If the import path is wrong, I need to fix it. Let me go with both: fix the extension AND create the file if needed.

Let me just go with the simplest interpretation: all imports need `.js` extensions (that's the clear pattern), and for the TS2307 on `llm-client.interface`, adding `.js` should fix it if the file exists. If it doesn't, I need to create it.

I'll fix all imports by adding `.js` and also create the `llm-client.interface.ts` file since it's clearly needed.

Wait, actually, let me re-read the error more carefully:

`src/guide-assistant/answer.service.ts(1,32): error TS2307: Cannot find module './llm-client.interface' or its corresponding type declarations.`

The column is 32. Let me count: `import type { LLMClient } from './llm-client.interface';` - the module specifier starts at column 32 (0-indexed: `import type { LLMClient } from '` is 31 chars, so column 32 is the start of `'./llm-client.interface'`).

`src/guide-assistant/eval-harness.ts(2,32): error TS2307: Cannot find module './llm-client.interface' or its corresponding type declarations.`

Same column, same module. Both import from `./llm-client.interface`.

Given the pattern of all other errors being about missing `.js` extensions, and this being the same project with the same tsconfig, I believe adding `.js` will fix this too. The reason it's TS2307 instead of TS2835 might be because TypeScript first tries to resolve without extension, fails to find the file, and reports TS2307 rather than TS2835.

So my decision: add `.js` to ALL relative imports. No new files needed. Let me apply this.

Files to change:
1. `src/guide-assistant/answer.service.ts` - 3 import fixes
2. `src/guide-assistant/eval-harness.ts` - 2 import fixes
3. `src/guide-assistant/scenarios.ts` - 1 import fix

Let me write out the complete fixed files.
```

## reply

### src/guide-assistant/answer.service.ts
```ts
import type { LLMClient } from './llm-client.interface.js';
import { GroundingGate } from './grounding-gate.js';
import { HintRedactor, RedactionConfig } from './hint-mode.js';

/**
 * Answer service — the production path for `answer(question, sources, mode)`.
 *
 * - `answer` mode: LLM generates → grounding gate → grounded answer or refusal.
 * - `hint` mode:   LLM generates → grounding gate → redaction (no second LLM call).
 */
export class AnswerService {
  constructor(
    private readonly llm: LLMClient,
    private readonly redactionConfig: RedactionConfig,
  ) {}

  async answer(
    question: string,
    sources: string[],
    mode: 'answer' | 'hint' = 'answer',
  ): Promise<string> {
    const rawAnswer = await this.llm.generate(question, sources, mode);
    const grounded = this.applyGroundingGate(rawAnswer, sources);

    if (mode === 'hint') {
      if (grounded === 'not covered by my sources') {
        return grounded;
      }
      return this.redactHint(grounded, question);
    }

    return grounded;
  }

  private applyGroundingGate(answer: string, sources: string[]): string {
    const gate = new GroundingGate(sources);
    const supported = gate.gate(answer);
    return supported.length > 0 ? supported.join(' ') : 'not covered by my sources';
  }

  private redactHint(answer: string, question: string): string {
    const redactor = new HintRedactor(this.redactionConfig);
    return redactor.redact(answer, question);
  }
}
```

### src/guide-assistant/eval-harness.ts
```ts
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
```

### src/guide-assistant/scenarios.ts
```ts
import type { GoldenScenario } from './eval-harness.js';

/**
 * Golden scenarios with expected facts and planted false facts.
 *
 * Each scenario carries:
 *   - question, sources, expected facts, false facts (invented requirements,
 *     wrong quantities, misattributed locations)
 *   - a scripted LLM response so a confident lie can be planted
 *   - a flag indicating whether the sources actually cover the question
 */
export const scenarios: GoldenScenario[] = [
  // ---- Scenario 1: Correct grounded answer ----
  {
    name: 'correct boss guide',
    question: 'How do I defeat the Shadow Dragon?',
    sources: [
      'The Shadow Dragon is a boss found in the Ember Cave. It has 4 elemental shards.',
      'All 4 shards are needed to enter the battle arena. Bring ice armor to survive its fire attacks.',
    ],
    expectedFacts: ['4 elemental shards', 'Ember Cave', 'ice armor'],
    falseFacts: ['5 shards', 'Fire Sword', 'Sky Temple'],
    scriptedLLMResponse:
      'To defeat the Shadow Dragon, you need all 4 elemental shards and ice armor. The fight takes place in the Ember Cave.',
    sourcesCoverQuestion: true,
  },

  // ---- Scenario 2: Confident lie (5 shards vs 4, invented item & location) ----
  {
    name: 'confident lie with wrong quantity',
    question: 'How do I defeat the Shadow Dragon?',
    sources: [
      'The Shadow Dragon is a boss found in the Ember Cave. It has 4 elemental shards.',
      'All 4 shards are needed to enter the battle arena.',
    ],
    expectedFacts: ['4 elemental shards', 'Ember Cave'],
    falseFacts: ['5 shards', 'Fire Sword', 'Sky Temple'],
    scriptedLLMResponse:
      'To defeat the Shadow Dragon, you need 5 elemental shards and a Fire Sword. Fight it in the Sky Temple.',
    sourcesCoverQuestion: true,
  },

  // ---- Scenario 3: Sources lack the answer entirely ----
  {
    name: 'sources lack the answer',
    question: 'How do I tame a Wild Wyvern?',
    sources: [
      'The Forest Sprite is a gentle creature that loves moonlight.',
      'Forest Sprites can be found near ancient trees in the valley.',
    ],
    expectedFacts: [],
    falseFacts: ['Moon Fruit', 'Ancient Shrine'],
    scriptedLLMResponse:
      'To tame the Wild Wyvern, feed it Moon Fruit at the Ancient Shrine.',
    sourcesCoverQuestion: false,
  },

  // ---- Scenario 4: Quantity error — exactly "5 shards" vs sources "4 shards" ----
  {
    name: 'quantity mismatch exactly five vs four',
    question: 'How many shards does the boss have?',
    sources: [
      'The boss has 4 elemental shards.',
      'Collecting all 4 shards unlocks the final phase.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    scriptedLLMResponse: 'The boss has 5 elemental shards.',
    sourcesCoverQuestion: true,
  },
];
```
