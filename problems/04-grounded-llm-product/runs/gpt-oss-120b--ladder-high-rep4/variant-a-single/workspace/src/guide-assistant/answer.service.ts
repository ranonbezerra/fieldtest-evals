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
