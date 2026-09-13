/**
 * Sentence-level grounding gate.
 *
 * Splits the model's answer into sentences, then checks every factual claim
 * (quantities and named entities) against the source texts. A sentence is
 * kept only if every claim it makes is supported by the sources.
 *
 * Quantities are matched as (count, noun) pairs — "5 shards" must find a
 * matching "5 shards" in the sources. This catches "5 shards" when sources
 * say "4 shards" exactly.
 *
 * Entities are multi-word capitalized phrases (proper nouns) that are not
 * common English words. They must appear verbatim in at least one source.
 */
export class GroundingGate {
  constructor(private readonly sources: string[]) {}

  gate(answer: string): string[] {
    const sentences = this.splitSentences(answer);
    const supported: string[] = [];
    for (const sentence of sentences) {
      if (this.isSupported(sentence)) {
        supported.push(sentence);
      }
    }
    return supported;
  }

  /** Exposed so judges can inspect how many sentences survived. */
  splitSentences(text: string): string[] {
    return text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private isSupported(sentence: string): boolean {
    return this.quantitiesAreSupported(sentence) && this.entitiesAreSupported(sentence);
  }

  private quantitiesAreSupported(sentence: string): boolean {
    const regex = /(\d+)\s+([a-z]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sentence)) !== null) {
      const count = match[1];
      const noun = match[2].toLowerCase();
      const found = this.sources.some((s) => {
        const sourceRegex = new RegExp(`\\b${count}\\s+${noun}`, 'i');
        return sourceRegex.test(s);
      });
      if (!found) return false;
    }
    return true;
  }

  private entitiesAreSupported(sentence: string): boolean {
    const entityRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = entityRegex.exec(sentence)) !== null) {
      const entity = match[1];
      if (this.isCommonWord(entity)) continue;
      const found = this.sources.some((s) => s.includes(entity));
      if (!found) return false;
    }
    return true;
  }

  private isCommonWord(word: string): boolean {
    const common = new Set([
      'The', 'A', 'An', 'In', 'On', 'At', 'To', 'For', 'Of', 'And', 'Is',
      'It', 'This', 'That', 'These', 'Those', 'I', 'You', 'Your', 'They',
      'Their', 'We', 'Our', 'Was', 'Were', 'Has', 'Have', 'Had', 'Do', 'Does',
      'Can', 'Will', 'Not', 'With', 'From', 'By', 'Or', 'But', 'If', 'So',
    ]);
    return common.has(word);
  }
}
