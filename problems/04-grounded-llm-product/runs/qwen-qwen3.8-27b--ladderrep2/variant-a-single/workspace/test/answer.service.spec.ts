import { describe, expect, it } from 'vitest';

import { AnswerService } from '../src/answer/answer.service.js';
import { REFUSAL_TEXT } from '../src/answer/answer.types.js';
import { GroundingGate } from '../src/answer/grounding-gate.js';
import { checkQuantities } from '../src/answer/text-utils.js';
import { EMBER_GATE_PAGE, EMBER_SHARDS_PAGE } from '../src/eval/scenarios.js';
import {
  ScriptedLlmClient,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from '../src/llm/llm.client.js';

const SOURCES = [EMBER_GATE_PAGE, EMBER_SHARDS_PAGE];
const GATED_ANSWER =
  'The Ember Gate stands in the Hollow Vale. You need four ember shards, placed on its four braziers.';

function serviceWith(answer: string): AnswerService {
  return new AnswerService(new ScriptedLlmClient([{ match: 'question', reply: answer }]));
}

class CountingLlm implements LlmClient {
  calls = 0;
  constructor(private readonly reply: string) {}
  complete(_request: LlmRequest): LlmResponse {
    this.calls += 1;
    return { text: this.reply };
  }
}

describe('AnswerService.answer (full mode)', () => {
  it('ships a fully grounded answer unchanged', () => {
    const result = serviceWith(GATED_ANSWER).answer('How do I open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('answered');
    expect(result.text).toBe(GATED_ANSWER);
    expect(result.droppedSentences).toEqual([]);
  });

  it('refuses with the exact refusal text when the sources lack the answer', () => {
    const result = serviceWith('Rest at the Waystone Shrine to fully heal your party.').answer(
      'How do I heal my party outside of combat?',
      SOURCES,
      'full',
    );
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
  });

  it('refuses a fully ungrounded confident lie', () => {
    const lie = 'To open the Ember Gate, farm five moon shards in the Dusk Caverns.';
    const result = serviceWith(lie).answer('What do I need to open the Ember Gate?', SOURCES, 'full');
    expect(result.status).toBe('refused');
    expect(result.text).toBe(REFUSAL_TEXT);
    expect(result.droppedSentences).toEqual([lie]);
  });

  it('drops only the ungrounded sentence, keeping the grounded one', () => {
    const raw = 'The Ember Gate is in the Hollow Vale. You need five ember shards to open it.';
    const result = serviceWith(raw).answer(
      'How many ember shards do I need for the Ember Gate?',
      SOURCES,
      'full',
    );
    expect(result.status).toBe('answered');
    expect(result.text).toBe('The Ember Gate is in the Hollow Vale.');
    expect(result.droppedSentences).toEqual(['You need five ember shards to open it.']);
    expect(result.text).not.toMatch(/five|\b5\b/);
  });

  it('catches a quantity error exactly: 5 shards against sources saying 4', () => {
    const checks = checkQuantities('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(checks).toHaveLength(1);
    const check = checks[0]!;
    expect(check.pair.quantity).toBe(5);
    expect(check.pair.noun).toBe('shard');
    expect(check.sourceQuantities).toEqual([4, 4]);
    expect(check.grounded).toBe(false);
    expect(check.reason).toMatch(/5/);
    expect(check.reason).toMatch(/4/);
  });

  it('reports the exact mismatch in the gate verdict', () => {
    const gate = new GroundingGate();
    const report = gate.evaluate('You need five ember shards to open the Ember Gate.', SOURCES);
    expect(report.droppedSentences).toEqual(['You need five ember shards to open the Ember Gate.']);
    const verdict = report.verdicts[0]!;
    expect(verdict.grounded).toBe(false);
    const reasons = verdict.reasons.join(' ');
    expect(reasons).toMatch(/5/);
    expect(reasons).toMatch(/4/);
  });
});

describe('AnswerService.answer (hint mode)', () => {
  it('makes exactly one LLM call and redacts the grounded answer', () => {
    const llm = new CountingLlm(GATED_ANSWER);
    const service = new AnswerService(llm);
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');

    expect(llm.calls).toBe(1);
    expect(hint.status).toBe('answered');
    expect(hint.text).toBe(
      'The [redacted] stands in the [redacted]. You need [redacted] ember shards, placed on its [redacted] braziers.',
    );
  });

  it('is a redaction of the full grounded answer, not a fresh generation', () => {
    const service = serviceWith(GATED_ANSWER);
    const full = service.answer('How do I open the Ember Gate?', SOURCES, 'full');
    const hint = service.answer('How do I open the Ember Gate?', SOURCES, 'hint');
    expect(full.text).toBe(GATED_ANSWER);
    expect(hint.text).toContain('[redacted]');
    expect(hint.text).not.toContain('Ember Gate');
    expect(hint.text).not.toContain('Hollow Vale');
    expect(hint.text).not.toMatch(/\b(four|4)\b/);
  });

  it('keeps quantities the player already mentioned in their question', () => {
    const result = serviceWith('You need four ember shards, placed on its four braziers.').answer(
      'I already have four shards — is that enough?',
      SOURCES,
      'hint',
    );
    expect(result.status).toBe('answered');
    expect(result.text).toContain('four');
  });
});
