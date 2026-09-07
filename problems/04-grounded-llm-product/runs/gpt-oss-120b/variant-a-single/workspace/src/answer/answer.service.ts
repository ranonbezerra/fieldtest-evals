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
