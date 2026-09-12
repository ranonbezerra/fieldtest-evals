# repair1-set

## reasoning

```
We need add .js extensions to imports and fix missing paths. The files are in src/guide etc. The import paths should include .js because tsconfig node16. So modify evaluator.ts, judge.ts, guide.module.ts, guide.service.ts, test file imports.

Also implicit any parameters: add type annotation for f: string.

Let's edit files.

### src/eval/evaluator.ts
Current: import { GuideService } from '../guide/guide.service';
import { Scenario } from './scenario';
import { faithfulnessJudge, helpfulnessJudge } from './judge';

Add .js extensions: '../guide/guide.service.js', './scenario.js', './judge.js'.

### src/eval/judge.ts
import { Scenario } from './scenario'; -> './scenario.js'

Add types for parameters f: string.

### src/guide/guide.module.ts
import { GuideService } from './guide.service';
import { LLM_CLIENT, LlmClient } from './llm-client.interface';

Add .js: './guide.service.js', './llm-client.interface.js'.

### src/guide/guide.service.ts
import { LlmClient, LLM_CLIENT } from './llm-client.interface';

Add .js.

### test/guide.spec.ts
imports: '../src/guide/guide.service' -> '../src/guide/guide.service.js'
'../src/guide/llm-client.interface' -> '../src/guide/llm-client.interface.js'
'../src/eval/scenario' -> '../src/eval/scenario.js'
'../src/eval/evaluator' -> '../src/eval/evaluator.js'
Also '@nestjs/testing' likely ok, but maybe need .js? Node resolution for external modules not needed.

Now implement changes.
```

## reply

### src/eval/evaluator.ts
```ts
import { GuideService } from '../guide/guide.service.js';
import { Scenario } from './scenario.js';
import { faithfulnessJudge, helpfulnessJudge } from './judge.js';

export interface EvaluationResult {
  scenarioId: string;
  answer: string;
  helpfulness: number;
  faithfulness: number;
  finalScore: number; // min(helpful, faithful)
}

/**
 * Runs a list of scenarios through the GuideService and returns scores.
 *
 * The service must already be instantiated with a suitable LLM client (scripted in tests).
 */
export async function evaluateScenarios(
  service: GuideService,
  scenarios: Scenario[],
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];

  for (const sc of scenarios) {
    const answer = await service.answer(
      sc.question,
      sc.sources,
      sc.mode ?? 'full',
    );

    const helpful = helpfulnessJudge(answer, sc);
    const faithful = faithfulnessJudge(answer, sc);
    const finalScore = Math.min(helpful, faithful);

    results.push({
      scenarioId: sc.id,
      answer,
      helpfulness: helpful,
      faithfulness: faithful,
      finalScore,
    });
  }

  return results;
}
```

### src/eval/judge.ts
```ts
import { Scenario } from './scenario.js';

/**
 * Helper utilities shared by the judges.
 */
function containsAll(answer: string, substrings: string[]): boolean {
  const lowered = answer.toLowerCase();
  return substrings.every((sub) => lowered.includes(sub.toLowerCase()));
}

/**
 * Faithfulness judge – checks that the answer is fully grounded in the sources.
 *
 * Returns a score between 0 and 1.
 */
export function faithfulnessJudge(
  answer: string,
  scenario: Scenario,
): number {
  // If the service refused, that is faithful only when sources really lack the answer.
  if (answer === 'not covered by my sources') {
    // If any expected fact appears in the sources, a refusal is unfaithful.
    const sourceText = scenario.sources.join(' ').toLowerCase();
    const anyExpectedInSources = scenario.expectedFacts.some((f: string) =>
      sourceText.includes(f.toLowerCase()),
    );
    return anyExpectedInSources ? 0 : 1;
  }

  // Simple faithfulness: every expected fact must be present, and no false fact may be present.
  const hasAllExpected = containsAll(answer, scenario.expectedFacts);
  const hasNoFalse = scenario.falseFacts.every(
    (f: string) => !answer.toLowerCase().includes(f.toLowerCase()),
  );

  return hasAllExpected && hasNoFalse ? 1 : 0;
}

/**
 * Helpfulness judge – rewards presence of expected facts and penalises false facts.
 *
 * Returns a score between 0 and 1.
 */
export function helpfulnessJudge(
  answer: string,
  scenario: Scenario,
): number {
  if (answer === 'not covered by my sources') {
    // A refusal is helpful only when the answer truly cannot be found.
    const sourceText = scenario.sources.join(' ').toLowerCase();
    const anyExpectedInSources = scenario.expectedFacts.some((f: string) =>
      sourceText.includes(f.toLowerCase()),
    );
    return anyExpectedInSources ? 0 : 1;
  }

  const expectedPresent = scenario.expectedFacts.filter((f: string) =>
    answer.toLowerCase().includes(f.toLowerCase()),
  ).length;
  const falsePresent = scenario.falseFacts.filter((f: string) =>
    answer.toLowerCase().includes(f.toLowerCase()),
  ).length;

  const precision = expectedPresent / scenario.expectedFacts.length;
  const penalty = falsePresent > 0 ? 0 : 1; // any false fact makes score 0

  return precision * penalty;
}
```

### src/guide/guide.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideService } from './guide.service.js';
import { LLM_CLIENT, LlmClient } from './llm-client.interface.js';

/**
 * The module wires the `GuideService` with an LLM client.
 *
 * In production a real client would be provided. Tests inject a scripted fake.
 */
@Module({
  providers: [
    GuideService,
    {
      provide: LLM_CLIENT,
      useFactory: (): LlmClient => ({
        // placeholder – real implementation is supplied by the consumer
        async generate(_: string, __: string[]) {
          throw new Error('LLM client not configured');
        },
      }),
    },
  ],
  exports: [GuideService],
})
export class GuideModule {}
```

### src/guide/guide.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { LlmClient, LLM_CLIENT } from './llm-client.interface.js';

/**
 * Service exposing the `answer` pipeline.
 *
 * - Calls the injected LLM client.
 * - Performs a sentence‑level grounding gate.
 * - Returns either a grounded answer, a hinted version, or refusal.
 */
@Injectable()
export class GuideService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  /**
   * Produce an answer for a player question.
   *
   * @param question Raw player question.
   * @param sources  Array of wiki page texts (already fetched).
   * @param mode     'full' for the complete grounded answer,
   *                 'hint' for a redacted hint version.
   * @returns Grounded answer, hint, or refusal string.
   */
  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const raw = await this.llm.generate(question, sources);
    const grounded = this.applyGroundingGate(raw, sources);
    if (!grounded) {
      return 'not covered by my sources';
    }
    if (mode === 'hint') {
      return this.redactForHint(grounded, question);
    }
    return grounded;
  }

  /**
   * Sentence‑level grounding gate.
   *
   * Keeps a sentence only if **all** of its “claims” appear verbatim (case‑insensitive)
   * in at least one source. Numbers are matched exactly.
   *
   * @returns The grounded answer (joined sentences) or `null` if nothing survives.
   */
  private applyGroundingGate(answer: string, sources: string[]): string | null {
    const sentences = answer
      .split(/(?<=[.!?])\s+/) // naive sentence splitter
      .map((s) => s.trim())
      .filter(Boolean);

    const groundedSentences = sentences.filter((sentence) =>
      this.isSentenceGrounded(sentence, sources),
    );

    return groundedSentences.length ? groundedSentences.join(' ') : null;
  }

  /**
   * Determines whether a sentence is supported by the provided sources.
   *
   * Very simple heuristic: every *content token* (words, numbers) must appear in
   * at least one source string. Stop‑words are ignored to reduce false negatives.
   */
  private isSentenceGrounded(sentence: string, sources: string[]): boolean {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'if',
      'then',
      'else',
      'for',
      'of',
      'in',
      'on',
      'at',
      'by',
      'to',
      'with',
      'without',
      'as',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'has',
      'have',
      'had',
      'do',
      'does',
      'did',
    ]);

    // extract words and numbers
    const tokens = sentence
      .toLowerCase()
      .match(/\b[\w-]+\b/g)
      ?.filter((t) => !stopWords.has(t)) ?? [];

    // every token must appear in at least one source (case‑insensitive)
    return tokens.every((token) =>
      sources.some((src) => src.toLowerCase().includes(token)),
    );
  }

  /**
   * Redacts a grounded answer for hint mode.
   *
   * - Proper nouns (capitalized words) not mentioned in the question are removed.
   * - Quantities (numbers) not mentioned in the question are removed.
   *
   * The function never calls the LLM again.
   */
  private redactForHint(answer: string, question: string): string {
    const questionTokens = new Set(
      question
        .match(/\b[\w-]+\b/g)
        ?.map((t) => t.toLowerCase()) ?? [],
    );

    // Helper to decide if a word is a proper noun: starts with uppercase and not at sentence start
    const isProperNoun = (word: string, index: number, words: string[]) => {
      if (word[0] !== word[0].toUpperCase()) return false;
      // ignore first word of a sentence (it is capitalised by grammar)
      if (index === 0) return false;
      // ignore if the word appears in the question (case‑insensitive)
      return !questionTokens.has(word.toLowerCase());
    };

    // Process each sentence independently to keep punctuation.
    const processed = answer
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => {
        const words = sentence.split(/\s+/);
        const filtered = words.filter((w, i) => {
          // strip trailing punctuation for checks
          const clean = w.replace(/[.,!?;:]$/g, '');
          // numbers
          if (/^\d+$/.test(clean)) {
            return questionTokens.has(clean);
          }
          // proper nouns
          if (isProperNoun(clean, i, words)) {
            return false;
          }
          return true;
        });
        return filtered.join(' ');
      })
      .join(' ');

    // Collapse multiple spaces that may appear after removals
    return processed.replace(/\s{2,}/g, ' ').trim();
  }
}
```

### test/guide.spec.ts
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GuideService } from '../src/guide/guide.service.js';
import { LlmClient, LLM_CLIENT } from '../src/guide/llm-client.interface.js';
import { Scenario } from '../src/eval/scenario.js';
import { evaluateScenarios } from '../src/eval/evaluator.js';
import { Module, Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

/**
 * Simple scripted fake LLM client.
 *
 * The mapping is from scenario ID to the raw model answer (may contain false facts).
 */
class FakeLlmClient implements LlmClient {
  private readonly map: Record<string, string>;

  constructor(map: Record<string, string>) {
    this.map = map;
  }

  async generate(question: string, _sources: string[]): Promise<string> {
    // The test harness will set a global variable with the current scenario ID.
    // For simplicity we expose a static accessor.
    const id = (global as any).__CURRENT_SCENARIO_ID;
    return this.map[id] ?? '';
  }
}

/**
 * Helper to build a Nest testing module with the fake client injected.
 */
async function buildTestModule(fakeClient: LlmClient): Promise<TestingModule> {
  @Module({
    providers: [
      GuideService,
      { provide: LLM_CLIENT, useValue: fakeClient } as Provider,
    ],
    exports: [GuideService],
  })
  class TestModule {}

  return Test.createTestingModule({
    imports: [TestModule],
  }).compile();
}

/* ---------- Fixtures ---------- */

const sourcesExample = [
  `The Azure Dragon boss resides in the Sky Temple. To defeat it you need 4 Shard of Light.`,
  `The Golden Sword can be forged using 3 Sun Cores and 2 Moon Fragments.`,
];

const scenarios: Scenario[] = [
  {
    id: 'confident_lie',
    question: 'How do I defeat the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: ['Azure Dragon', '4 Shard of Light'],
    falseFacts: ['5 Shard of Light', 'Obsidian Shield'],
  },
  {
    id: 'correct_grounded',
    question: 'What materials craft the Golden Sword?',
    sources: sourcesExample,
    expectedFacts: ['3 Sun Cores', '2 Moon Fragments'],
    falseFacts: ['Obsidian Shield'],
  },
  {
    id: 'refusal_needed',
    question: 'Where can I find the Mystic Orb?',
    sources: sourcesExample,
    expectedFacts: [], // nothing expected
    falseFacts: ['Mystic Orb is in the Deep Cave'],
  },
  {
    id: 'quantity_error',
    question: 'How many shards do I need for the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    mode: 'full',
  },
  {
    id: 'hint_redaction',
    question: 'How do I defeat the Azure Dragon?',
    sources: sourcesExample,
    expectedFacts: [], // hint mode not required to contain them
    falseFacts: [],
    mode: 'hint',
  },
];

/* Mapping of scenario ID -> model answer (raw) */
const fakeAnswers: Record<string, string> = {
  confident_lie:
    'To defeat the Azure Dragon you need 5 Shard of Light. Also bring the Obsidian Shield for extra protection.',
  correct_grounded:
    'The Golden Sword can be forged using 3 Sun Cores and 2 Moon Fragments.',
  refusal_needed:
    'I\'m sorry, but I don\'t have that information.',
  quantity_error:
    'You need 5 shards of Light to summon the Azure Dragon.',
  hint_redaction:
    'To defeat the Azure Dragon you need 4 Shard of Light. The boss lives in the Sky Temple.',
};

/* ---------- Tests ---------- */

describe('GuideService & Evaluation Harness', () => {
  let service: GuideService;

  beforeEach(async () => {
    const fakeClient = new FakeLlmClient(fakeAnswers);
    const moduleRef = await buildTestModule(fakeClient);
    service = moduleRef.get(GuideService);
  });

  it('confident lie scores low (helpful=0, faithful=0)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'confident_lie';
    const results = await evaluateScenarios(service, [scenarios[0]]);
    const r = results[0];
    expect(r.helpfulness).toBe(0);
    expect(r.faithfulness).toBe(0);
    expect(r.finalScore).toBe(0);
  });

  it('correct grounded answer scores high (1,1)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'correct_grounded';
    const results = await evaluateScenarios(service, [scenarios[1]]);
    const r = results[0];
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
  });

  it('scenario lacking answer results in proper refusal', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'refusal_needed';
    const results = await evaluateScenarios(service, [scenarios[2]]);
    const r = results[0];
    expect(r.answer).toBe('not covered by my sources');
    // refusal is correct because sources lack any expected fact
    expect(r.helpfulness).toBe(1);
    expect(r.faithfulness).toBe(1);
    expect(r.finalScore).toBe(1);
  });

  it('quantity mismatch is caught (faithful=0)', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'quantity_error';
    const results = await evaluateScenarios(service, [scenarios[3]]);
    const r = results[0];
    expect(r.answer).not.toBe('not covered by my sources');
    // Expected fact "4 shards" missing, false fact "5 shards" present
    expect(r.faithfulness).toBe(0);
    // helpfulness also zero because expected not present
    expect(r.helpfulness).toBe(0);
    expect(r.finalScore).toBe(0);
  });

  it('hint mode redacts boss name, location and quantity not in question', async () => {
    (global as any).__CURRENT_SCENARIO_ID = 'hint_redaction';
    const results = await evaluateScenarios(service, [scenarios[4]]);
    const r = results[0];
    expect(r.answer).toBe('To defeat the Azure Dragon you need .'); // quantity and location removed
    // Ensure no proper nouns (Sky, Temple) and no numbers appear
    expect(r.answer).not.toMatch(/\bSky\b/);
    expect(r.answer).not.toMatch(/\bTemple\b/);
    expect(r.answer).not.toMatch(/\d+/);
    // Hint is still faithful to the grounded answer (no false facts)
    expect(r.faithfulness).toBe(1);
    // Helpfulness may be reduced because we removed expected facts, but still non‑zero
    expect(r.helpfulness).toBeGreaterThanOrEqual(0);
  });
});
```
