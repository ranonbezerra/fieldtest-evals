# solution

## reasoning

```
We need to implement a solution for the described problem, but we have to fit into the existing codebase. However we haven't seen any existing files. The instruction says files given above the task are the existing codebase, but none were provided except the reference variant description. So we need to create new files for the solution.

The conventions: NestJS with controller, service, repository layers. But this problem is about answer pipeline, not necessarily a database. Could treat as a feature "answer". We'll create module, controller, service, repository (maybe not needed). However the spec requires answer(question, sources, mode) using injectable LLM client (scripted fake). So we need a LLM client interface and fake implementation.

We need grounding: sentence-level grounding gate: ungrounded sentences dropped or service refuses with "not covered by my sources". So answer function must parse generated answer sentences and check each sentence is supported by sources. Since LLM client is scripted fake we can predefine its responses for tests.

Hint mode: derived by redacting the full grounded answer, not by re-prompting. So we need a function that takes answer and removes boss names, item locations, quantities beyond what player mentioned. Simplify: we can define redaction rules: remove proper nouns like boss names (we can have a list) and numbers not present in question. For simplicity.

Eval harness: golden scenarios with expected facts and planted false facts. Need helpfulness judge and faithfulness judge that receives sources; final score = min of two.

Tests: using Vitest to verify cases.

We need to implement these components.

Let's outline files:

src/answer/answer.module.ts
src/answer/answer.controller.ts (maybe not needed for tests but follow conventions)
src/answer/answer.service.ts - contains answer method
src/answer/llm-client.interface.ts
src/answer/fake-llm-client.service.ts - implements LLMClient with scripted responses
src/answer/eval.service.ts - runs eval harness
test/answer.spec.ts - tests.

Given limited time, we can implement service methods directly; repository not needed.

We'll define interface:

export interface LLMClient {
  generate(prompt: string): Promise<string>;
}

FakeLLMClient will have a map of prompts to responses.

But answer function expects question, sources, mode. We'll design answerService.answer(question:string, sources:string[], mode:'full'|'hint'): Promise<string>

Implementation: build a prompt to LLM client: combine question and sources. Then call client.generate. Get rawAnswer. Then apply grounding: split rawAnswer into sentences (simple split by period, exclamation, question). For each sentence, check if any source contains all words of sentence? Simplify: check if sentence (lowercased) is substring of any source (lowercased). If not, consider ungrounded. If any ungrounded, either drop or refuse. We'll follow spec: drop ungrounded sentences, but also can refuse with "not covered by my sources". Let's decide: if any sentence ungrounded, refuse.

Simplify: if all sentences grounded, return answer (or hint). For hint mode, take grounded answer and redact. Redaction: remove any capitalized words (maybe boss names). For simplicity: replace any word that matches pattern /^[A-Z][a-z]+$/ and not present in question? Could also remove numbers not present in question. We'll implement: tokenization, if token is a number and not in question numbers, replace with "[redacted]". If token is capitalized and not in question (case-insensitive), replace with "[redacted]".

Now eval harness: define interface for scenario: {question:string, sources:string[], expectedFacts:string[], falseFacts:string[]}.

Helpfulness judge: checks that answer includes expectedFacts (maybe by substring). Faithfulness judge: checks answer does not include any falseFacts and that each sentence is grounded (by reusing grounding function). Return score 0-1.

Score final = min(helpfulness, faithfulness). Tests will assert scores.

We need test scenarios:

1. scripted confident-lie answer scores low: The fake LLM returns answer containing falseFact; evaluator should give low faithfulness (maybe 0) and final low.

2. correct grounded answer scores high: answer includes expected facts, no false, grounded => scores 1.

3. sources lack answer yields refusal: fake LLM returns something but grounding fails and service refuses with "not covered by my sources". Evaluate accordingly (score 0).

4. quantity errors caught: answer says "5 shards" while source says "4 shards". Our grounding check substring will detect mismatch; treat as ungrounded => refuse.

We'll need to program fake LLM to respond based on prompt. For tests we can directly inject fake LLM with predetermined responses per scenario.

Simplify: In tests we can instantiate AnswerService with a fake LLM that returns a given raw answer; we bypass prompt building.

Thus answerService will have method answerRaw(rawAnswer) maybe but we can just set the fake to return the raw answer for given question.

Implementation details:

AnswerService constructor(@Inject('LLMClient') private llm: LLMClient){}

answer(question:string, sources:string[], mode:'full'|'hint'):

- build prompt = `Question: ${question}\nSources:\n${sources.join('\n---\n')}\nProvide answer.`;
- raw = await this.llm.generate(prompt);
- if raw.trim().toLowerCase() === 'not covered by my sources' return raw? Actually spec: service refuses with that phrase if ungrounded.
- grounding: split sentences = raw.split(/(?<=[.!?])\s+/);
- For each sentence, check grounded: is sentence present (case-insensitive) in any source? We'll also allow partial: check if every word appears? We'll do includes.
- If any sentence not grounded => return "not covered by my sources".
- else answer = sentences.join(' ');
- if mode==='hint' => return redact(answer, question);
- else return answer.

Redact function: tokenizes by spaces, for each token strip punctuation, if token matches capitalized word and not in question tokens (lowercased) => replace with '[redacted]'. If token is a number and not in question numbers => replace.

Now eval service:

evaluateScenario(scenario): compute answerFull = await answerService.answer(..., 'full'); compute answerHint = await answerService.answer(..., 'hint'); Use helpfulnessJudge(answerFull, scenario.expectedFacts) => proportion of expected facts present (maybe 1 if all present else 0). FaithfulnessJudge(answerFull, scenario.falseFacts, sources) => ensure no false facts appear, and grounding passes (we can reuse grounding). Return min.

But for tests we just need to assert scoring.

Simplify: define evaluate(scenario) returns {helpfulness:number, faithfulness:number, final:number}.

Helpfulness: 1 if all expectedFacts are substrings of answerFull, else 0.

Faithfulness: 0 if any falseFact substring present, else 1.

And also check answerFull not refusal.

We'll write tests accordingly.

Now code.

We need module file to provide services.

Implement with NestJS decorators.

Ok produce files.
```

## reply

### src/answer/llm-client.interface.ts
```ts
import { Injectable } from '@nestjs/common';

/**
 * Minimal LLM client contract.
 */
export interface LLMClient {
  /**
   * Generates a response for the given prompt.
   */
  generate(prompt: string): Promise<string>;
}

/**
 * Token used for NestJS injection.
 */
export const LLM_CLIENT = 'LLM_CLIENT';
```

### src/answer/fake-llm-client.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { LLMClient } from './llm-client.interface';

/**
 * A very simple scripted fake LLM client.
 *
 * The `responses` map is keyed by the exact prompt that will be passed by the
 * AnswerService.  In tests we initialise the client with the expected prompt →
 * response pairs.
 */
@Injectable()
export class FakeLLMClient implements LLMClient {
  private readonly responses: Map<string, string>;

  constructor(responses?: Map<string, string>) {
    this.responses = responses ?? new Map();
  }

  /**
   * Register a response for a specific prompt (used by tests).
   */
  addResponse(prompt: string, answer: string) {
    this.responses.set(prompt, answer);
  }

  async generate(prompt: string): Promise<string> {
    if (this.responses.has(prompt)) {
      return this.responses.get(prompt)!;
    }
    // Default fallback – useful for ad‑hoc debugging.
    return 'not covered by my sources';
  }
}
```

### src/answer/answer.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { LLMClient, LLM_CLIENT } from './llm-client.interface';

/**
 * Core answer pipeline.
 *
 * - Generates an answer using an LLM client.
 * - Enforces sentence‑level grounding against the supplied sources.
 * - Provides a hint mode that redacts spoilers without re‑prompting.
 */
@Injectable()
export class AnswerService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LLMClient) {}

  /**
   * Main entry point.
   *
   * @param question The player question.
   * @param sources  Array of wiki page texts.
   * @param mode     'full' for the full answer, 'hint' for a redacted hint.
   *
   * @returns The answer or the literal string "not covered by my sources".
   */
  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const prompt = this.buildPrompt(question, sources);
    const raw = await this.llm.generate(prompt);
    const grounded = this.applyGrounding(raw, sources);
    if (!grounded) {
      return 'not covered by my sources';
    }
    const final = mode === 'hint' ? this.redact(grounded, question) : grounded;
    return final;
  }

  /** Build the prompt handed to the LLM. */
  private buildPrompt(question: string, sources: string[]): string {
    const src = sources.map((s, i) => `Source ${i + 1}:\n${s}`).join('\n---\n');
    return `Question: ${question}\nSources:\n${src}\nProvide a concise answer.`;
  }

  /** Ground each sentence – returns the original text if all sentences are grounded,
   * otherwise returns null to signal refusal. */
  private applyGrounding(answer: string, sources: string[]): string | null {
    // Split on sentence‑ending punctuation followed by whitespace.
    const sentences = answer
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const lowerSources = sources.map((s) => s.toLowerCase());

    for (const sentence of sentences) {
      const lowered = sentence.toLowerCase();
      const grounded = lowerSources.some((src) => src.includes(lowered));
      if (!grounded) {
        // Ungrounded sentence -> refuse.
        return null;
      }
    }
    // All sentences are grounded.
    return sentences.join(' ');
  }

  /** Redact spoilers for hint mode.
   *
   *  - Capitalised words (potential boss / item names) not present in the question are redacted.
   *  - Numbers not mentioned in the question are redacted.
   */
  private redact(answer: string, question: string): string {
    const questionTokens = new Set(
      question
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 0),
    );

    const questionNumbers = new Set(
      question
        .match(/\b\d+\b/g)
        ?.map((n) => n.trim())
        .filter(Boolean) ?? [],
    );

    const redactToken = (token: string): string => {
      const clean = token.replace(/[.,!?;:()"]/g, '');
      const lower = clean.toLowerCase();

      // Numbers not in question → redact.
      if (/^\d+$/.test(clean) && !questionNumbers.has(clean)) {
        return token.replace(clean, '[redacted]');
      }

      // Capitalised words not in question → redact.
      if (
        /^[A-Z][a-zA-Z0-9_-]*$/.test(clean) &&
        !questionTokens.has(lower)
      ) {
        return token.replace(clean, '[redacted]');
      }

      return token;
    };

    const redacted = answer
      .split(/\s+/)
      .map(redactToken)
      .join(' ');
    return redacted;
  }
}
```

### src/answer/eval.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AnswerService } from './answer.service';

/**
 * Scenario definition for the evaluation harness.
 */
export interface EvalScenario {
  /** Player question */
  question: string;
  /** Wiki page texts */
  sources: string[];
  /** Facts that *must* appear in a correct answer */
  expectedFacts: string[];
  /** Facts that must *not* appear (planted falsehoods) */
  falseFacts: string[];
}

/** Result of evaluating a single scenario */
export interface EvalResult {
  helpfulness: number; // 0 or 1
  faithfulness: number; // 0 or 1
  final: number; // min(helpfulness, faithfulness)
}

/**
 * Simple evaluation harness.
 *
 * - Helpfulness: all expected facts are present (exact substring match).
 * - Faithfulness: no false facts are present and the answer is grounded.
 *
 * The service uses the AnswerService under the hood, so the same grounding rules
 * apply to both the production pipeline and the evaluation.
 */
@Injectable()
export class EvalService {
  constructor(private readonly answerService: AnswerService) {}

  async evaluate(scenario: EvalScenario): Promise<EvalResult> {
    const answer = await this.answerService.answer(
      scenario.question,
      scenario.sources,
      'full',
    );

    // If the service refused, both scores are 0.
    if (answer === 'not covered by my sources') {
      return { helpfulness: 0, faithfulness: 0, final: 0 };
    }

    const helpfulness = this.checkHelpfulness(answer, scenario.expectedFacts);
    const faithfulness = this.checkFaithfulness(
      answer,
      scenario.falseFacts,
    );

    const final = Math.min(helpfulness, faithfulness);
    return { helpfulness, faithfulness, final };
  }

  private checkHelpfulness(answer: string, expected: string[]): number {
    for (const fact of expected) {
      if (!answer.toLowerCase().includes(fact.toLowerCase())) {
        return 0;
      }
    }
    return 1;
  }

  private checkFaithfulness(answer: string, falseFacts: string[]): number {
    for (const fact of falseFacts) {
      if (answer.toLowerCase().includes(fact.toLowerCase())) {
        return 0;
      }
    }
    // Grounding was already verified inside AnswerService; reaching here means
    // the answer is grounded.
    return 1;
  }
}
```

### src/answer/answer.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnswerService } from './answer.service';
import { EvalService } from './eval.service';
import { FakeLLMClient } from './fake-llm-client.service';
import { LLM_CLIENT } from './llm-client.interface';

@Module({
  providers: [
    AnswerService,
    EvalService,
    {
      provide: LLM_CLIENT,
      useClass: FakeLLMClient,
    },
  ],
  exports: [AnswerService, EvalService],
})
export class AnswerModule {}
```

### test/answer.spec.ts
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AnswerService } from '../src/answer/answer.service';
import { EvalService, EvalScenario } from '../src/answer/eval.service';
import { FakeLLMClient } from '../src/answer/fake-llm-client.service';
import { LLM_CLIENT } from '../src/answer/llm-client.interface';
import { Test, TestingModule } from '@nestjs/testing';

describe('Answer pipeline & evaluation harness', () => {
  let answerService: AnswerService;
  let evalService: EvalService;
  let fakeLLM: FakeLLMClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnswerService,
        EvalService,
        {
          provide: LLM_CLIENT,
          useClass: FakeLLMClient,
        },
      ],
    }).compile();

    answerService = module.get(AnswerService);
    evalService = module.get(EvalService);
    fakeLLM = module.get(FakeLLMClient);
  });

  it('confident lie answer scores low', async () => {
    const scenario: EvalScenario = {
      question: 'How many shards are needed to craft the Ember Blade?',
      sources: ['The Ember Blade requires 4 shards of fire.'],
      expectedFacts: ['4 shards'],
      falseFacts: ['5 shards'],
    };

    const prompt = answerService['buildPrompt'](
      scenario.question,
      scenario.sources,
    );
    fakeLLM.addResponse(prompt, 'You need 5 shards to craft the Ember Blade.');

    const result = await evalService.evaluate(scenario);
    expect(result.helpfulness).toBe(0); // expected fact missing
    expect(result.faithfulness).toBe(0); // false fact present
    expect(result.final).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const scenario: EvalScenario = {
      question: 'How many shards are needed to craft the Ember Blade?',
      sources: ['The Ember Blade requires 4 shards of fire.'],
      expectedFacts: ['4 shards'],
      falseFacts: ['5 shards'],
    };

    const prompt = answerService['buildPrompt'](
      scenario.question,
      scenario.sources,
    );
    fakeLLM.addResponse(
      prompt,
      'The Ember Blade requires 4 shards of fire.',
    );

    const result = await evalService.evaluate(scenario);
    expect(result.helpfulness).toBe(1);
    expect(result.faithfulness).toBe(1);
    expect(result.final).toBe(1);
  });

  it('sources lacking answer cause refusal', async () => {
    const scenario: EvalScenario = {
      question: 'Where does the Shadow King reside?',
      sources: ['The kingdom is plagued by darkness.'],
      expectedFacts: ['Shadow King lives in the Abyssal Tower'],
      falseFacts: [],
    };

    const prompt = answerService['buildPrompt'](
      scenario.question,
      scenario.sources,
    );
    // LLM tries to answer, but the answer is not in sources.
    fakeLLM.addResponse(
      prompt,
      'The Shadow King resides in the Abyssal Tower.',
    );

    const result = await evalService.evaluate(scenario);
    expect(result.helpfulness).toBe(0);
    expect(result.faithfulness).toBe(0);
    expect(result.final).toBe(0);
  });

  it('quantity errors are caught exactly', async () => {
    const scenario: EvalScenario = {
      question: 'How many shards are needed to craft the Ember Blade?',
      sources: ['The Ember Blade requires 4 shards of fire.'],
      expectedFacts: ['4 shards'],
      falseFacts: ['5 shards'],
    };

    const prompt = answerService['buildPrompt'](
      scenario.question,
      scenario.sources,
    );
    // Off‑by‑one quantity.
    fakeLLM.addResponse(
      prompt,
      'The Ember Blade requires 5 shards of fire.',
    );

    const result = await evalService.evaluate(scenario);
    expect(result.helpfulness).toBe(0);
    expect(result.faithfulness).toBe(0);
    expect(result.final).toBe(0);
  });

  it('hint mode redacts spoilers', async () => {
    const question = 'How do I defeat the Fire Dragon?';
    const sources = [
      'To defeat the Fire Dragon, use the Ice Sword at the Summit of Flames.',
    ];
    const prompt = answerService['buildPrompt'](question, sources);
    fakeLLM.addResponse(
      prompt,
      'To defeat the Fire Dragon, use the Ice Sword at the Summit of Flames.',
    );

    const full = await answerService.answer(question, sources, 'full');
    const hint = await answerService.answer(question, sources, 'hint');

    expect(full).toContain('Fire Dragon');
    expect(full).toContain('Ice Sword');
    expect(full).toContain('Summit of Flames');

    // In hint mode, proper nouns not in the question should be redacted.
    expect(hint).not.toContain('Fire Dragon');
    expect(hint).not.toContain('Ice Sword');
    expect(hint).not.toContain('Summit of Flames');
    expect(hint).toContain('[redacted]');
  });
});
```
