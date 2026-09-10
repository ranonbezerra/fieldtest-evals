import { Injectable } from '@nestjs/common';

// ASSUMPTION: './assistant.grounding' exports `isSentenceGrounded(sentence: string, sources: string[]): boolean`
// ASSUMPTION: './assistant.llm-client' exports `LlmClient` as an injectable with method `generate(question: string, sources: string[]): Promise<string>`
// ASSUMPTION: './assistant.redaction' exports `redactForHint(answer: string, sources: string[], question: string): string`

import { isSentenceGrounded } from './assistant.grounding';
import { LlmClient } from './assistant.llm-client';
import { redactForHint } from './assistant.redaction';

export type AnswerMode = 'full' | 'hint';

export interface AnswerResult {
  answer: string;
  grounded: boolean;
}

@Injectable()
export class AssistantService {
  constructor(private readonly llmClient: LlmClient) {}

  async answer(
    question: string,
    sources: string[],
    mode: AnswerMode,
  ): Promise<AnswerResult> {
    const rawAnswer = await this.llmClient.generate(question, sources);

    const sentences = this.splitSentences(rawAnswer);
    const groundedSentences = sentences.filter((s) => isSentenceGrounded(s, sources));

    if (groundedSentences.length === 0) {
      return { answer: 'not covered by my sources', grounded: false };
    }

    const groundedText = groundedSentences.join(' ');

    if (mode === 'hint') {
      return { answer: redactForHint(groundedText, sources, question), grounded: true };
    }

    return { answer: groundedText, grounded: true };
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
