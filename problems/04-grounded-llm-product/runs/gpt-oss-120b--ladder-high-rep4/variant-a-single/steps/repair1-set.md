# repair1-set

## reasoning

```
We need to fix import extensions and missing files. Probably missing llm-client.interface.ts and judges.ts. They aren't provided, but likely exist? Not in references. Need to create them with proper exports. Also add .js extensions in imports per ESM. Update imports to include .js? In TypeScript with "type": "module", need .js extensions in compiled output, but source imports should have .js? Usually need .js. So change imports like './answer.service' to './answer.service.js' etc. Also add missing files with minimal definitions: llm-client.interface.ts exporting interface LLMClient with generate method. judges.ts exporting types and functions used: Scenario, helpfulnessJudge, faithfulnessJudge. Implement simple stubs to satisfy compile.

Implement judges simple: helpfulnessJudge returns 1 if answer contains all expectedFacts and not any falseFacts else 0. FaithfulnessJudge returns 1 if all sentences in answer are grounded? But can just return 1 for now; tests rely on final score. For confident lie scenario, answer will be 'not covered...' so helpfulnessJudge maybe 0? In test expects final 0 and answer 'not covered...' So helpfulnessJudge likely 0. For correct scenario answer equals llmAnswer, which is grounded, helpfulness 1, faithfulness 1.

Implement simple logic.

Add file src/guide-assistant/judges.ts.

Update imports in eval.ts to './answer.service.js', './judges.js'.

Update other imports similarly.

Also test file imports need .js extensions? In test files, they import '../src/guide-assistant/answer.service' - need .js? For TypeScript compile, same issue. Add .js extensions.

Also fix implicit any in test arrow functions: add type any or unknown. Simplest: add explicit type any: (s: any) => ...

But better to change test imports with generic? Actually errors at lines 19,28 etc where they filter scenario.id. Those are in test file using .find callback. Add type annotation: (s: any) => s.id === ... . We'll modify test file.

Let's produce changed files: src/guide-assistant/answer.service.ts import path? It imports './llm-client.interface' – need .js extension. Change to './llm-client.interface.js'.

src/guide-assistant/eval.ts imports './answer.service' and './judges' – add .js.

src/guide-assistant/guide-assistant.module.ts same.

test/guide-assistant.spec.ts imports '../src/guide-assistant/answer.service', '../src/guide-assistant/llm-client.interface', '../src/guide-assistant/eval' – add .js.

Also fix implicit any: annotate parameters.

Create src/guide-assistant/llm-client.interface.ts and src/guide-assistant/judges.ts.

Let's output changed files.
```

## reply

### src/guide-assistant/answer.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { LLMClient } from './llm-client.interface.js';

/**
 * Service that answers player questions using a language model,
 * then applies a sentence‑level grounding gate and, optionally,
 * a redaction‑based hint mode.
 */
@Injectable()
export class AnswerService {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Produce an answer.
   *
   * @param question Player question.
   * @param sources  Array of wiki page texts.
   * @param mode     "full" for the grounded answer, "hint" for the redacted hint.
   * @returns        Grounded answer, a hint, or the refusal string.
   */
  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const prompt = this.buildPrompt(question, sources);
    const raw = await this.llm.generate(prompt);
    const grounded = this.applyGrounding(raw, sources);
    if (grounded === null) {
      return 'not covered by my sources';
    }
    if (mode === 'hint') {
      return this.redactHint(grounded, question);
    }
    return grounded;
  }

  /** Build a deterministic prompt for the LLM. */
  private buildPrompt(question: string, sources: string[]): string {
    return `Question: ${question}
Sources:
${sources.map((s, i) => `--- source ${i + 1} ---\n${s}`).join('\n')}
Answer:`;
  }

  /** Apply the grounding gate – keep only sentences supported by sources. */
  private applyGrounding(answer: string, sources: string[]): string | null {
    // Split on sentence terminators while preserving them.
    const sentences = answer
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const groundedSentences = sentences.filter((sentence) =>
      this.isGrounded(sentence, sources),
    );

    if (groundedSentences.length === 0) {
      return null;
    }
    return groundedSentences.join(' ');
  }

  /**
   * Simple grounding predicate: a sentence is considered grounded if it appears
   * (case‑insensitively) as a substring of *any* source text.
   *
   * This is sufficient for the test harness where the fake LLM returns
   * sentences that are either verbatim copies of source sentences or
   * fabricated hallucinations.
   */
  private isGrounded(sentence: string, sources: string[]): boolean {
    const lowered = sentence.toLowerCase();
    return sources.some((src) => src.toLowerCase().includes(lowered));
  }

  /**
   * Derive a hint by redacting boss names, locations and quantities that
   * the player has not mentioned in the original question.
   *
   * No second LLM call is performed – the method works purely on text.
   */
  private redactHint(answer: string, question: string): string {
    const questionTokens = new Set(
      question
        .split(/\W+/)
        .filter(Boolean)
        .map((t) => t.toLowerCase()),
    );

    // Very small stop‑word list to avoid over‑redaction of common words.
    const STOPWORDS = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'if',
      'in',
      'on',
      'at',
      'by',
      'to',
      'for',
      'with',
      'as',
      'of',
      'from',
      'into',
      'over',
      'under',
      'above',
      'below',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'should',
      'can',
      'could',
      'may',
      'might',
      'must',
      'shall',
      'i',
      'you',
      'he',
      'she',
      'it',
      'we',
      'they',
      'my',
      'your',
      'his',
      'her',
      'its',
      'our',
      'their',
    ]);

    // Redact quantities (numbers optionally followed by a single word, e.g. "3 shards").
    let redacted = answer.replace(/\b\d+\s*\w*\b/g, (match) => {
      if (!questionTokens.has(match.toLowerCase())) {
        return '[REDACTED]';
      }
      return match;
    });

    // Redact capitalised words that are not stop‑words and not mentioned in the question.
    redacted = redacted.replace(/\b([A-Z][a-zA-Z]+)\b/g, (match) => {
      const lower = match.toLowerCase();
      if (STOPWORDS.has(lower)) {
        return match;
      }
      if (!questionTokens.has(lower)) {
        return '[REDACTED]';
      }
      return match;
    });

    return redacted;
  }
}
```

### src/guide-assistant/eval.ts
```ts
import { AnswerService } from './answer.service.js';
import { Scenario, helpfulnessJudge, faithfulnessJudge } from './judges.js';

/**
 * Evaluate a single scenario using a pre‑configured `AnswerService`.
 *
 * The service must already be wired with an `LLMClient` that returns the
 * `scenario.llmAnswer` string (the test harness creates such a client).
 *
 * @param svc    Instance of `AnswerService`.
 * @param scenario Golden scenario definition.
 * @param mode   "full" for a complete answer, "hint" for the redacted hint.
 * @returns      Scores and the generated answer.
 */
export async function evaluateScenario(
  svc: AnswerService,
  scenario: Scenario,
  mode: 'full' | 'hint' = 'full',
): Promise<{
  helpful: number;
  faithful: number;
  final: number;
  answer: string;
}> {
  const answer = await svc.answer(scenario.question, scenario.sources, mode);
  const helpful = helpfulnessJudge(
    answer,
    scenario.expectedFacts,
    scenario.falseFacts,
  );
  const faithful = faithfulnessJudge(answer, scenario.sources);
  const final = Math.min(helpful, faithful);
  return { helpful, faithful, final, answer };
}

/**
 * A collection of golden scenarios used by the evaluation harness.
 *
 * The scenarios cover:
 *   - A correct, fully grounded answer.
 *   - A confident hallucination (should score low).
 *   - A missing answer (service should refuse).
 *   - A quantity mismatch (e.g., "5 shards" vs. source "4 shards").
 *   - A hint‑mode example that must redact bosses, locations and unmentioned quantities.
 */
export const GOLDEN_SCENARIOS: Scenario[] = [
  {
    id: 'correct',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: [],
    llmAnswer:
      'You need 4 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'confident_lie',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    llmAnswer:
      'You need 5 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'refusal',
    question: 'Where can I find the Mystic Key?',
    sources: [
      'The ancient ruins hold many secrets, but no key is mentioned here.',
    ],
    expectedFacts: [],
    falseFacts: [],
    llmAnswer:
      'The Mystic Key is located in the Whispering Tower.',
  },
  {
    id: 'quantity_error',
    question: 'How many shards do I need to craft the Crystal Sword?',
    sources: [
      'You need 4 shards of light to craft the Crystal Sword.',
    ],
    expectedFacts: ['4 shards'],
    falseFacts: ['5 shards'],
    llmAnswer:
      'You need 5 shards of light to craft the Crystal Sword.',
  },
  {
    id: 'hint',
    question: 'What do I need to defeat the final boss?',
    sources: [
      'To defeat Lord of Shadows, you must collect 3 Shadow Orbs and venture into the Dark Forest.',
    ],
    expectedFacts: ['Shadow Orbs', 'Dark Forest'],
    falseFacts: [],
    llmAnswer:
      'To defeat Lord of Shadows, you must collect 3 Shadow Orbs and venture into the Dark Forest.',
  },
];
```

### src/guide-assistant/guide-assistant.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnswerService } from './answer.service.js';
import { LLMClient } from './llm-client.interface.js';

/**
 * NestJS module that provides the guide‑assistant service.
 *
 * In a production environment the `LLMClient` provider would be bound to a real
 * implementation. For tests a mock client is injected directly when constructing
 * `AnswerService`.
 */
@Module({
  providers: [
    AnswerService,
    {
      provide: 'LLMClient',
      useFactory: (): LLMClient => ({
        async generate(_: string): Promise<string> {
          // Placeholder – overridden in tests or by a real implementation.
          return '';
        },
      }),
    },
  ],
  exports: [AnswerService],
})
export class GuideAssistantModule {}
```

### src/guide-assistant/llm-client.interface.ts
```ts
/**
 * Minimal interface for an LLM client used by the guide assistant.
 */
export interface LLMClient {
  /**
   * Generate a completion given a prompt.
   * @param prompt The prompt string.
   */
  generate(prompt: string): Promise<string>;
}
```

### src/guide-assistant/judges.ts
```ts
/**
 * Types and simple judges used by the evaluation harness.
 */

export interface Scenario {
  id: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  falseFacts: string[];
  llmAnswer: string;
}

/**
 * Helpfulness judge: returns 1 if all expected facts appear in the answer
 * and none of the false facts appear; otherwise 0.
 */
export function helpfulnessJudge(
  answer: string,
  expectedFacts: string[],
  falseFacts: string[],
): number {
  const lower = answer.toLowerCase();
  const hasAllExpected = expectedFacts.every((f) => lower.includes(f.toLowerCase()));
  const hasNoFalse = falseFacts.every((f) => !lower.includes(f.toLowerCase()));
  return hasAllExpected && hasNoFalse ? 1 : 0;
}

/**
 * Faithfulness judge: returns 1 if every sentence in the answer is grounded
 * in the provided sources (simple substring check), otherwise 0.
 */
export function faithfulnessJudge(answer: string, sources: string[]): number {
  // Split answer into sentences.
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allGrounded = sentences.every((sentence) => {
    const lowered = sentence.toLowerCase();
    return sources.some((src) => src.toLowerCase().includes(lowered));
  });
  return allGrounded ? 1 : 0;
}
```

### test/guide-assistant.spec.ts
```ts
import { describe, it, expect } from 'vitest';
import { AnswerService } from '../src/guide-assistant/answer.service.js';
import { LLMClient } from '../src/guide-assistant/llm-client.interface.js';
import { evaluateScenario, GOLDEN_SCENARIOS } from '../src/guide-assistant/eval.js';

/**
 * Simple deterministic LLM client used in tests.
 * It ignores the prompt and always returns the pre‑configured answer.
 */
class TestLLMClient implements LLMClient {
  constructor(private readonly answer: string) {}
  async generate(_: string): Promise<string> {
    return this.answer;
  }
}

describe('Guide Assistant Evaluation Harness', () => {
  it('scripted confident lie scores low', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'confident_lie')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(0);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('correct grounded answer scores high', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'correct')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(1);
    expect(result.answer).toBe(scenario.llmAnswer);
  });

  it('sources lacking the answer produce a refusal and score as correct', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'refusal')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(1);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('quantity errors are caught exactly (5 shards vs 4 shards)', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'quantity_error')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario);
    expect(result.final).toBe(0);
    expect(result.answer).toBe('not covered by my sources');
  });

  it('hint mode redacts boss names, locations and unmentioned quantities', async () => {
    const scenario = GOLDEN_SCENARIOS.find((s: any) => s.id === 'hint')!;
    const llm = new TestLLMClient(scenario.llmAnswer);
    const svc = new AnswerService(llm);
    const result = await evaluateScenario(svc, scenario, 'hint');
    const hint = result.answer;

    // Ensure boss name parts are removed.
    expect(hint).not.toContain('Lord');
    expect(hint).not.toContain('Shadows');

    // Ensure location is removed.
    expect(hint).not.toContain('Dark');
    expect(hint).not.toContain('Forest');

    // Ensure the quantity (3) is removed.
    expect(hint).not.toMatch(/\b3\b/);
  });
});
```
