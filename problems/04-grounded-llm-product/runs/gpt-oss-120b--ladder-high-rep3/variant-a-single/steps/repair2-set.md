# repair2-set

## reasoning

```
We need adjust imports to include .js extension due to ESM. All files import without .js. Add .js to relative imports. Files: src/guide-assistant/eval.ts imports './guide-assistant.service' and './llm-client.interface' -> need ./guide-assistant.service.js and ./llm-client.interface.js. Similarly other files.

Also test imports need .js? Tests compiled with ts-node? Probably also need .js. Add .js extensions.

Implement changes.
```

## reply

### src/guide-assistant/eval.ts
```ts
import { GuideAssistantService } from './guide-assistant.service.js';
import { LLMClient } from './llm-client.interface.js';
```

### src/guide-assistant/guide-assistant.controller.ts
```ts
import { Controller, Post, Body, Query } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

type AnswerMode = 'full' | 'hint';

@Controller('guide')
export class GuideAssistantController {
  constructor(private readonly guideService: GuideAssistantService) {}

  @Post('answer')
  async answer(
    @Body('question') question: string,
    @Body('sources') sources: string[],
    @Query('mode') mode: AnswerMode = 'full',
  ): Promise<{ answer: string }> {
    const answer = await this.guideService.answer(question, sources, mode);
    return { answer };
  }
}
```

### src/guide-assistant/guide-assistant.module.ts
```ts
import { Module } from '@nestjs/common';
import { GuideAssistantService } from './guide-assistant.service.js';

@Module({
  providers: [GuideAssistantService],
  exports: [GuideAssistantService],
})
export class GuideAssistantModule {}
```

### src/guide-assistant/guide-assistant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { LLMClient } from './llm-client.interface.js';

@Injectable()
export class GuideAssistantService {
  private readonly refusalMessage = 'not covered by my sources';

  constructor(private readonly llmClient: LLMClient) {}

  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const prompt = this.buildPrompt(question, sources);
    const rawAnswer = await this.llmClient.generate(prompt);
    const grounded = this.applyGrounding(rawAnswer, sources);
    if (!grounded) {
      return this.refusalMessage;
    }
    if (mode === 'hint') {
      return this.redact(grounded, question);
    }
    return grounded;
  }

  private buildPrompt(question: string, sources: string[]): string {
    // Simple prompt composition.
    return `Question: ${question}\n\nSources:\n${sources.join('\n---\n')}`;
  }

  private splitSentences(text: string): string[] {
    // Split on sentence‑ending punctuation.
    const regex = /[^.!?]+[.!?]+/g;
    const matches = text.match(regex);
    if (matches) {
      return matches.map(s => s.trim());
    }
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }

  private isSentenceGrounded(sentence: string, sources: string[]): boolean {
    const loweredSentence = sentence.toLowerCase();

    // Numeric phrase check (e.g., "5 shards").
    const numericPhrases = loweredSentence.match(/\b\d+\s+\w+\b/g);
    if (numericPhrases) {
      for (const phrase of numericPhrases) {
        const found = sources.some(src => src.toLowerCase().includes(phrase));
        if (!found) {
          return false;
        }
      }
    }

    // Simple grounding: sentence appears (as substring) in any source.
    return sources.some(src => src.toLowerCase().includes(loweredSentence));
  }

  private applyGrounding(answer: string, sources: string[]): string | null {
    const sentences = this.splitSentences(answer);
    const groundedSentences = sentences.filter(sentence =>
      this.isSentenceGrounded(sentence, sources),
    );
    if (groundedSentences.length === 0) {
      return null;
    }
    return groundedSentences.join(' ');
  }

  private redact(answer: string, question: string): string {
    // Tokens that are allowed because they appear in the question.
    const allowed = new Set(
      question
        .toLowerCase()
        .split(/\s+/)
        .map(tok => tok.replace(/[.,!?;:]/g, '')),
    );

    const tokens = answer.split(/\s+/);
    const redactedTokens: string[] = [];

    for (const token of tokens) {
      const cleaned = token.replace(/[.,!?;:]/g, '');
      const lower = cleaned.toLowerCase();

      // Redact pure numbers (quantities) not mentioned in the question.
      if (/^\d+$/.test(cleaned) && !allowed.has(lower)) {
        continue;
      }

      // Redact capitalized words (proper nouns) not mentioned in the question.
      if (cleaned && /^[A-Z]/.test(cleaned) && !allowed.has(lower)) {
        continue;
      }

      redactedTokens.push(token);
    }

    return redactedTokens.join(' ');
  }
}
```

### test/guide-assistant.spec.ts
```ts
import { describe, it, expect } from 'vitest';
import { GuideAssistantService } from '../src/guide-assistant/guide-assistant.service.js';
import { LLMClient } from '../src/guide-assistant/llm-client.interface.js';
import { helpfulnessJudge, faithfulnessJudge } from '../src/guide-assistant/eval.js';

class FakeLLMClient implements LLMClient {
  constructor(private readonly answer: string) {}
  async generate(_prompt: string): Promise<string> {
    return this.answer;
  }
}

/** Helper to create a service wired to a deterministic fake LLM. */
function createService(fakeAnswer: string): GuideAssistantService {
  const client = new FakeLLMClient(fakeAnswer);
  return new GuideAssistantService(client);
}

describe('GuideAssistantService – grounding and hint mode', () => {
  it('confident lie scores low', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 3 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 5 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'confident-lie',
      question,
      sources,
      expectedFacts: ['You need 3 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(0);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(0);
  });

  it('correct grounded answer scores high', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 3 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 3 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('You need 3 shards to craft the Mystic Sword.');

    const scenario = {
      name: 'correct-answer',
      question,
      sources,
      expectedFacts: ['You need 3 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(1);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(1);
  });

  it('sources lacking answer result in correct refusal', async () => {
    const question = 'Where is the golden key?';
    const sources = ['The silver key lies in the castle courtyard.'];
    const llmAnswer = 'The golden key is hidden in the forest.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'missing-answer',
      question,
      sources,
      expectedFacts: [],
      falseFacts: [],
      expectAnswer: false,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(1);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(1);
  });

  it('quantity mismatch is caught and leads to refusal', async () => {
    const question = 'How many shards do I need?';
    const sources = ['You need 4 shards to craft the Mystic Sword.'];
    const llmAnswer = 'You need 5 shards to craft the Mystic Sword.';
    const service = createService(llmAnswer);
    const answer = await service.answer(question, sources, 'full');

    expect(answer).toBe('not covered by my sources');

    const scenario = {
      name: 'quantity-mismatch',
      question,
      sources,
      expectedFacts: ['You need 4 shards'],
      falseFacts: [],
      expectAnswer: true,
      llmAnswer,
    };
    const helpful = helpfulnessJudge(answer, scenario);
    const faithful = faithfulnessJudge(answer, sources);
    expect(helpful).toBe(0);
    expect(faithful).toBe(1);
    expect(Math.min(helpful, faithful)).toBe(0);
  });

  it('hint mode redacts boss names, locations, and unmentioned quantities', async () => {
    const question = 'How do I get the shards?';
    const sources = [
      'Defeat the DragonLord in the Ember Cave. You need 3 shards.',
    ];
    const llmAnswer = 'Defeat the DragonLord in the Ember Cave. You need 3 shards.';
    const service = createService(llmAnswer);
    const hint = await service.answer(question, sources, 'hint');

    // Ensure spoiler‑sensitive tokens are removed.
    expect(hint).not.toContain('DragonLord');
    expect(hint).not.toContain('Ember');
    expect(hint).not.toContain('Cave');
    expect(hint).not.toContain('3');

    // Generic item reference should remain.
    expect(hint).toContain('shards');
  });
});
```
