import { Inject, Injectable } from '@nestjs/common';

import { isGrounded, splitSentences, tokenSet } from './grounding.js';
import { LLM_CLIENT, type LlmClient, type LlmRequest } from './llm-client.js';
import { redactSpoilers } from './spoiler-redactor.js';
import { REFUSAL_MESSAGE, type AnswerMode, type AnswerResult, type WikiSource } from './types.js';

const SYSTEM_PROMPT = [
  'You are a gameplay guide assistant.',
  'Answer ONLY using the provided wiki pages; never invent items, quantities, names, or locations.',
  `If the pages do not cover the question, reply exactly: ${REFUSAL_MESSAGE}.`,
].join(' ');

/**
 * Answer pipeline: prompt the injected LLM, gate its output sentence by
 * sentence against the sources, and — in hint mode — redact the grounded
 * answer locally. The LLM is never re-prompted for the hint.
 */
@Injectable()
export class AssistantService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<AnswerResult> {
    const raw = await this.llm.complete(this.buildPrompt(question, sources));

    const sourceTokens = tokenSet(...sources.map((source) => source.text));
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const sentence of splitSentences(raw)) {
      if (isGrounded(sentence, sourceTokens)) {
        kept.push(sentence);
      } else {
        dropped.push(sentence);
      }
    }

    if (kept.length === 0) {
      // Every sentence failed the grounding gate: refuse rather than guess.
      return { mode, status: 'refused', answer: REFUSAL_MESSAGE, droppedSentences: dropped };
    }

    const groundedAnswer = kept.join(' ');

    if (mode === 'full') {
      return { mode, status: 'answered', answer: groundedAnswer, droppedSentences: dropped };
    }

    // Hint mode is a redaction of the full grounded answer, not a new prompt.
    const hint = redactSpoilers(groundedAnswer, { question, sources });
    return { mode, status: 'answered', answer: hint, droppedSentences: dropped };
  }

  private buildPrompt(question: string, sources: WikiSource[]): LlmRequest {
    const pages = sources
      .map((source, index) => `Page ${index + 1} — ${source.title}:\n${source.text}`)
      .join('\n\n');
    return {
      system: SYSTEM_PROMPT,
      user: `Question: ${question}\n\nWiki pages:\n${pages}`,
    };
  }
}
