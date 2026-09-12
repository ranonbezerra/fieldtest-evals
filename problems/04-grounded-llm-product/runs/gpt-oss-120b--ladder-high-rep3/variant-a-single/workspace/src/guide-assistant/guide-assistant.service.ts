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
