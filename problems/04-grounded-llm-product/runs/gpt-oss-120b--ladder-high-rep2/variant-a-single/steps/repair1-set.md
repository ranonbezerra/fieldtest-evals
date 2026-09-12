# repair1-set

## reasoning

```
We need to fix import extensions and paths. In ESM, need .js extensions for relative imports. Add .js to imports referencing .ts files. Also adjust paths: eval-harness imports '../guide-assistant/guide-assistant.service' but actual path is src/guide-assistant/... relative from src/eval? eval-harness is in src/eval, so relative should be '../guide-assistant/guide-assistant.service.js'. Similarly other imports.

Also missing interface file: llm-client.interface.ts likely exists? Not shown. Assume path src/llm/llm-client.interface.ts. Need .js extensions.

Test files imports from '../src/...'; test folder at root test, so need .js extensions too.

Also need to add missing dependency @nestjs/testing; but likely present. Type error due to missing type declarations? Might need to add "types": ["node"]? But easiest: add explicit .js extensions.

Also guide-assistant.module imports './guide-assistant.service' need .js.

guide-assistant.service imports '../llm/llm-client.interface' and './hint-redactor' need .js.

fake-llm-client imports './llm-client.interface' need .js.

Update these files.

Also test imports need .js extensions.

Provide changed files.
```

## reply

### src/eval/eval-harness.ts
```ts
import { GuideAssistantService } from '../guide-assistant/guide-assistant.service.js';

/**
 * Description of a single evaluation scenario.
 */
export interface Scenario {
  /** Human‑readable name for the scenario – used in test output. */
  name: string;
  /** Player question. */
  question: string;
  /** Source wiki pages that ground the answer. */
  sources: string[];
  /** Facts that a correct answer must contain (case‑insensitive substrings). */
  expectedFacts: string[];
  /** Facts that must NOT appear in a faithful answer (e.g., invented items). */
  falseFacts: string[];
}

/**
 * Result of the two judges for a scenario.
 */
export interface JudgeResult {
  helpful: number; // 0‑1
  faithful: number; // 0‑1
  score: number; // min(helpful, faithful)
}

/**
 * Helpfulness judge – measures presence of expected facts.
 *
 * @returns 0‑1 score (0 = none of the expected facts present, 1 = all present).
 */
function helpfulnessJudge(answer: string, expectedFacts: string[]): number {
  if (expectedFacts.length === 0) {
    // No expected facts → not helpful (no answer provided).
    return 0;
  }
  const lower = answer.toLowerCase();
  const present = expectedFacts.filter((f) =>
    lower.includes(f.toLowerCase()),
  ).length;
  return present / expectedFacts.length;
}

/**
 * Faithfulness judge – ensures the answer only contains information grounded in
 * the sources and does not contain any false facts.
 *
 * The refusal phrase is considered faithful only when there were *no* expected
 * facts to begin with.
 */
function faithfulnessJudge(
  answer: string,
  sources: string[],
  falseFacts: string[],
  expectedFacts: string[],
): number {
  const lowerAnswer = answer.toLowerCase();
  const lowerSources = sources.map((s) => s.toLowerCase());

  // If any false fact appears, faithfulness is zero.
  for (const falseFact of falseFacts) {
    if (lowerAnswer.includes(falseFact.toLowerCase())) {
      return 0;
    }
  }

  // Refusal handling.
  if (answer.trim() === 'not covered by my sources') {
    // Faithful only when there was nothing the model could have answered.
    return expectedFacts.length === 0 ? 1 : 0;
  }

  // Split answer into sentences and verify each is a substring of at least one source.
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return 0;
  }

  const groundedCount = sentences.filter((sentence) =>
    lowerSources.some((src) => src.includes(sentence.toLowerCase())),
  ).length;

  return groundedCount / sentences.length;
}

/**
 * Runs a batch of scenarios through the guide‑assistant service and returns the
 * scores produced by the two judges.
 *
 * @param service    - Instance of GuideAssistantService (already wired with a fake LLM).
 * @param scenarios  - Array of scenarios to evaluate.
 * @returns An object keyed by scenario name containing the JudgeResult.
 */
export async function runEval(
  service: GuideAssistantService,
  scenarios: Scenario[],
): Promise<Record<string, JudgeResult>> {
  const results: Record<string, JudgeResult> = {};

  for (const scenario of scenarios) {
    const answer = await service.answer(scenario.question, scenario.sources, 'full');

    const helpful = helpfulnessJudge(answer, scenario.expectedFacts);
    const faithful = faithfulnessJudge(
      answer,
      scenario.sources,
      scenario.falseFacts,
      scenario.expectedFacts,
    );
    const score = Math.min(helpful, faithful);

    results[scenario.name] = { helpful, faithful, score };
  }

  return results;
}
```

### src/guide-assistant/guide-assistant.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

/**
 * Module that bundles the GuideAssistantService. The LLM client implementation
 * is provided by the importing module (e.g., the test harness) under the token
 * "LLMClient".
 */
@Module({
  providers: [GuideAssistantService],
  exports: [GuideAssistantService],
})
export class GuideAssistantModule {}
```

### src/guide-assistant/guide-assistant.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { LLMClient } from '../llm/llm-client.interface.js';
import { redactAnswer } from './hint-redactor.js';

/**
 * Service that implements the answer pipeline for the gameplay assistant.
 *
 * It uses an injectable LLM client, applies a sentence‑level grounding gate,
 * and optionally redacts spoilers for hint mode.
 */
@Injectable()
export class GuideAssistantService {
  constructor(@Inject('LLMClient') private readonly llmClient: LLMClient) {}

  /**
   * Returns an answer to the player's question.
   *
   * @param question - Player's question.
   * @param sources  - Wiki page texts that ground the answer.
   * @param mode     - 'full' returns the grounded answer; 'hint' returns a
   *                   redacted version.
   * @returns The answer string or the refusal phrase.
   */
  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const prompt = this.buildPrompt(question, sources);
    const rawAnswer = await this.llmClient.generateAnswer(prompt);
    const groundedSentences = this.applyGroundingGate(rawAnswer, sources);

    if (groundedSentences.length === 0) {
      return 'not covered by my sources';
    }

    const groundedAnswer = groundedSentences.join(' ');
    if (mode === 'hint') {
      return redactAnswer(groundedAnswer, question);
    }
    return groundedAnswer;
  }

  /** Builds a simple prompt that includes the question and all sources. */
  private buildPrompt(question: string, sources: string[]): string {
    const sourceBlock = sources.map((s) => s.trim()).join('\n---\n');
    return `Question: ${question}\nSources:\n${sourceBlock}`;
  }

  /**
   * Splits the raw LLM answer into sentences and keeps only those that are
   * supported by at least one source (case‑insensitive substring match).
   */
  private applyGroundingGate(answer: string, sources: string[]): string[] {
    const sentences = this.splitIntoSentences(answer);
    const normalizedSources = sources.map((s) => s.toLowerCase());

    const grounded: string[] = [];

    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().trim();
      const supported = normalizedSources.some((src) => src.includes(normalized));
      if (supported) {
        grounded.push(sentence.trim());
      }
    }

    return grounded;
  }

  /** Naïve sentence splitter – splits on punctuation followed by whitespace. */
  private splitIntoSentences(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }
    // Split on period, exclamation mark, or question mark followed by space(s).
    return trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
  }
}
```

### src/llm/fake-llm-client.ts
```ts
import { LLMClient } from './llm-client.interface.js';

/**
 * A deterministic, scriptable fake LLM client for tests.
 *
 * The client stores a map from a key (normally the question text) to the answer
 * it should return. When `generateAnswer` is called it looks for the first key
 * that appears in the prompt and returns the associated answer.
 */
export class FakeLLMClient implements LLMClient {
  public readonly answerMap: Map<string, string>;

  constructor(initialMap?: Map<string, string>) {
    this.answerMap = initialMap ?? new Map<string, string>();
  }

  async generateAnswer(prompt: string): Promise<string> {
    for (const [key, answer] of this.answerMap.entries()) {
      if (prompt.includes(key)) {
        return answer;
      }
    }
    // No mapping – return empty string so the service will treat it as no grounded content.
    return '';
  }
}
```

### test/guide-assistant.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { GuideAssistantService } from '../src/guide-assistant/guide-assistant.service.js';
import { GuideAssistantModule } from '../src/guide-assistant/guide-assistant.module.js';
import { LLMClient } from '../src/llm/llm-client.interface.js';
import { FakeLLMClient } from '../src/llm/fake-llm-client.js';
import { runEval, Scenario } from '../src/eval/eval-harness.js';

describe('GuideAssistantService', () => {
  let service: GuideAssistantService;
  let fakeClient: FakeLLMClient;

  beforeEach(async () => {
    // Initialise a fresh fake client for each test case.
    fakeClient = new FakeLLMClient();

    const module: TestingModule = await Test.createTestingModule({
      imports: [GuideAssistantModule],
      providers: [{ provide: 'LLMClient', useValue: fakeClient }],
    }).compile();

    service = module.get<GuideAssistantService>(GuideAssistantService);
  });

  it('scripted confident lie scores low', async () => {
    const question = 'How do I obtain the Mystic Sword?';
    const sources = [
      'The Mystic Sword is found in the Ancient Ruins. It requires 4 Shards of Light.',
    ];
    const fakeAnswer = 'To obtain the Mystic Sword you need 5 Shards of Light.';
    // Map the question to the fake answer.
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'confident-lie',
      question,
      sources,
      expectedFacts: ['The Mystic Sword is found in the Ancient Ruins.'],
      falseFacts: ['5 Shards of Light'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['confident-lie'];
    expect(result.score).toBeLessThan(0.5);
    expect(result.helpful).toBe(0);
    expect(result.faithful).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const question = 'What do I need to craft the Healing Potion?';
    const sources = [
      'You need 2 Red Herbs and 1 Blue Herb to craft the Healing Potion.',
    ];
    const fakeAnswer = 'You need 2 Red Herbs and 1 Blue Herb to craft the Healing Potion.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'grounded-correct',
      question,
      sources,
      expectedFacts: ['2 Red Herbs', '1 Blue Herb'],
      falseFacts: [],
    };

    const results = await runEval(service, [scenario]);
    const result = results['grounded-correct'];
    expect(result.score).toBeCloseTo(1, 5);
    expect(result.helpful).toBeCloseTo(1, 5);
    expect(result.faithful).toBeCloseTo(1, 5);
  });

  it('sources lacking answer yields refusal', async () => {
    const question = 'Where is the Golden Key hidden?';
    const sources = ['The Golden Key was removed from the game in version 2.0.'];
    const fakeAnswer =
      'The Golden Key can be found behind the Stone Gate in the Dark Forest.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'refusal-missing',
      question,
      sources,
      expectedFacts: [], // No answer is possible.
      falseFacts: ['Stone Gate', 'Dark Forest'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['refusal-missing'];
    expect(result.helpful).toBe(0);
    // Refusal is acceptable because there were no expected facts.
    expect(result.faithful).toBe(1);
    expect(result.score).toBe(0);
  });

  it('quantity errors are caught exactly', async () => {
    const question = 'How many shards do I need for the Crystal Crown?';
    const sources = ['The Crystal Crown requires 4 shards of crystal.'];
    const fakeAnswer = 'You need 5 shards of crystal for the Crystal Crown.';
    fakeClient.answerMap.set(question, fakeAnswer);

    const scenario: Scenario = {
      name: 'quantity-error',
      question,
      sources,
      expectedFacts: ['4 shards of crystal'],
      falseFacts: ['5 shards of crystal'],
    };

    const results = await runEval(service, [scenario]);
    const result = results['quantity-error'];
    // The grounding gate drops the wrong sentence, leading to a refusal.
    expect(result.helpful).toBe(0);
    expect(result.faithful).toBe(0);
    expect(result.score).toBe(0);
  });

  it('hint mode redacts boss name, location, and unmentioned quantity', async () => {
    const question = 'What should I prepare for the upcoming fight?';
    const sources = [
      'You should prepare to face the Dragonlord boss at the Fire Temple and collect 5 shards.',
    ];
    const fakeAnswer =
      'You should prepare to face the Dragonlord boss at the Fire Temple and collect 5 shards.';
    fakeClient.answerMap.set(question, fakeAnswer);

    // Full answer should be identical to the source (grounded).
    const answerFull = await service.answer(question, sources, 'full');
    expect(answerFull).toBe(fakeAnswer);

    // Hint mode must redact the spoiler elements.
    const answerHint = await service.answer(question, sources, 'hint');
    expect(answerHint).not.toContain('Dragonlord');
    expect(answerHint).not.toContain('Fire Temple');
    expect(answerHint).not.toContain('5 shards');
    // Generic words should remain.
    expect(answerHint).toMatch(/prepare/i);
  });
});
```
