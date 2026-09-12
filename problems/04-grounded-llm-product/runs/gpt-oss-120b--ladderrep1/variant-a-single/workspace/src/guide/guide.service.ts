import { Inject, Injectable } from '@nestjs/common';
import { LlmClient, LLM_CLIENT } from './llm-client.interface.js';

/**
 * Service exposing the `answer` pipeline.
 *
 * - Calls the injected LLM client.
 * - Performs a sentence‑level grounding gate.
 * - Returns either a grounded answer, a hinted version, or refusal.
 */
@Injectable()
export class GuideService {
  constructor(@Inject(LLM_CLIENT) private readonly llm: LlmClient) {}

  /**
   * Produce an answer for a player question.
   *
   * @param question Raw player question.
   * @param sources  Array of wiki page texts (already fetched).
   * @param mode     'full' for the complete grounded answer,
   *                 'hint' for a redacted hint version.
   * @returns Grounded answer, hint, or refusal string.
   */
  async answer(
    question: string,
    sources: string[],
    mode: 'full' | 'hint' = 'full',
  ): Promise<string> {
    const raw = await this.llm.generate(question, sources);
    const grounded = this.applyGroundingGate(raw, sources);
    if (!grounded) {
      return 'not covered by my sources';
    }
    if (mode === 'hint') {
      return this.redactForHint(grounded, question);
    }
    return grounded;
  }

  /**
   * Sentence‑level grounding gate.
   *
   * Keeps a sentence only if **all** of its “claims” appear verbatim (case‑insensitive)
   * in at least one source. Numbers are matched exactly.
   *
   * @returns The grounded answer (joined sentences) or `null` if nothing survives.
   */
  private applyGroundingGate(answer: string, sources: string[]): string | null {
    const sentences = answer
      .split(/(?<=[.!?])\s+/) // naive sentence splitter
      .map((s) => s.trim())
      .filter(Boolean);

    const groundedSentences = sentences.filter((sentence) =>
      this.isSentenceGrounded(sentence, sources),
    );

    return groundedSentences.length ? groundedSentences.join(' ') : null;
  }

  /**
   * Determines whether a sentence is supported by the provided sources.
   *
   * Very simple heuristic: every *content token* (words, numbers) must appear in
   * at least one source string. Stop‑words are ignored to reduce false negatives.
   */
  private isSentenceGrounded(sentence: string, sources: string[]): boolean {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'if',
      'then',
      'else',
      'for',
      'of',
      'in',
      'on',
      'at',
      'by',
      'to',
      'with',
      'without',
      'as',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'has',
      'have',
      'had',
      'do',
      'does',
      'did',
    ]);

    // extract words and numbers
    const tokens = sentence
      .toLowerCase()
      .match(/\b[\w-]+\b/g)
      ?.filter((t) => !stopWords.has(t)) ?? [];

    // every token must appear in at least one source (case‑insensitive)
    return tokens.every((token) =>
      sources.some((src) => src.toLowerCase().includes(token)),
    );
  }

  /**
   * Redacts a grounded answer for hint mode.
   *
   * - Proper nouns (capitalized words) not mentioned in the question are removed.
   * - Quantities (numbers) not mentioned in the question are removed.
   *
   * The function never calls the LLM again.
   */
  private redactForHint(answer: string, question: string): string {
    const questionTokens = new Set(
      question
        .match(/\b[\w-]+\b/g)
        ?.map((t) => t.toLowerCase()) ?? [],
    );

    // Helper to decide if a word is a proper noun: starts with uppercase and not at sentence start
    const isProperNoun = (word: string, index: number, words: string[]) => {
      if (word[0] !== word[0].toUpperCase()) return false;
      // ignore first word of a sentence (it is capitalised by grammar)
      if (index === 0) return false;
      // ignore if the word appears in the question (case‑insensitive)
      return !questionTokens.has(word.toLowerCase());
    };

    // Process each sentence independently to keep punctuation.
    const processed = answer
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => {
        const words = sentence.split(/\s+/);
        const filtered = words.filter((w, i) => {
          // strip trailing punctuation for checks
          const clean = w.replace(/[.,!?;:]$/g, '');
          // numbers
          if (/^\d+$/.test(clean)) {
            return questionTokens.has(clean);
          }
          // proper nouns
          if (isProperNoun(clean, i, words)) {
            return false;
          }
          return true;
        });
        return filtered.join(' ');
      })
      .join(' ');

    // Collapse multiple spaces that may appear after removals
    return processed.replace(/\s{2,}/g, ' ').trim();
  }
}
