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
