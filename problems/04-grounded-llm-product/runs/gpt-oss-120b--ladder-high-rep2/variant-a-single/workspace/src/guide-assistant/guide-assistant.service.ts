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
