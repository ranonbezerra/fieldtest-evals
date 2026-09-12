import { LLMClient } from './llm-client.interface';

export type AnswerMode = 'full' | 'hint';

/**
 * Core service that produces an answer, applies a sentence‑level grounding gate,
 * and optionally derives a hint mode by redacting the grounded answer.
 */
export class AnswerService {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Returns a grounded answer or a refusal string.
   * In "hint" mode the answer is redacted instead of returned verbatim.
   */
  async answer(
    question: string,
    sources: string[],
    mode: AnswerMode = 'full'
  ): Promise<string> {
    const raw = await this.llm.generate(question, sources);
    const grounded = this.applyGroundingGate(raw, sources);
    if (!grounded) {
      return 'not covered by my sources';
    }
    const finalAnswer = mode === 'hint' ? this.applyHintRedaction(grounded, question) : grounded;
    return finalAnswer;
  }

  /**
   * Removes any sentence that is not supported by the provided sources.
   * Returns `null` when no sentence survives the gate.
   */
  private applyGroundingGate(text: string, sources: string[]): string | null {
    const sentences = this.splitIntoSentences(text);
    const groundedSentences = sentences.filter((s) => this.isSentenceGrounded(s, sources));
    if (groundedSentences.length === 0) {
      return null;
    }
    return groundedSentences.map((s) => s.trim()).join(' ');
  }

  /**
   * Very simple sentence splitter based on punctuation followed by whitespace
   * and a capital letter (good enough for the test fixtures).
   */
  private splitIntoSentences(text: string): string[] {
    const regex = /(?<=[.!?])\s+(?=[A-Z])/g;
    return text.split(regex).map((s) => s.trim()).filter(Boolean);
  }

  /**
   * Determines whether a sentence is covered by any of the sources.
   * The implementation is a case‑insensitive substring check – sufficient for
   * the synthetic test data where sentences appear verbatim.
   */
  private isSentenceGrounded(sentence: string, sources: string[]): boolean {
    const normalized = sentence.toLowerCase().trim();
    return sources.some((src) => src.toLowerCase().includes(normalized));
  }

  /**
   * Hint‑mode redaction. Removes:
   *   – Proper nouns (capitalized words) that are not the first token of the sentence
   *     and that do not appear in the player's question.
   *   – Numeric tokens that are not mentioned in the question.
   * The redaction is performed purely by string manipulation; no second LLM call.
   */
  private applyHintRedaction(answer: string, question: string): string {
    const questionWords = new Set(
      question
        .toLowerCase()
        .replace(/[.,!?]/g, '')
        .split(/\s+/)
        .filter(Boolean)
    );

    const sentences = this.splitIntoSentences(answer);
    const redactedSentences = sentences.map((sentence) => {
      const tokens = sentence.split(/\b/);
      const redactedTokens = tokens.map((token, idx) => {
        const trimmed = token.trim();

        // Keep whitespace / punctuation as‑is
        if (!trimmed) {
          return token;
        }

        // Numeric tokens (e.g., "3") – drop unless the number appears in the question
        if (/^\d+$/.test(trimmed)) {
          return questionWords.has(trimmed) ? token : '';
        }

        // Proper nouns: capitalized words not at sentence start
        const isCapitalized = /^[A-Z][a-zA-Z0-9]+$/.test(trimmed);
        const isFirstToken = idx === 0;
        if (isCapitalized && !isFirstToken) {
          const lower = trimmed.toLowerCase();
          if (!questionWords.has(lower)) {
            return '';
          }
        }

        return token;
      });

      // Collapse consecutive spaces and trim the sentence
      const redacted = redactedTokens.join('').replace(/\s{2,}/g, ' ').trim();
      return redacted;
    });

    // Join the (possibly empty) sentences back together
    return redactedSentences.filter(Boolean).join(' ');
  }
}
