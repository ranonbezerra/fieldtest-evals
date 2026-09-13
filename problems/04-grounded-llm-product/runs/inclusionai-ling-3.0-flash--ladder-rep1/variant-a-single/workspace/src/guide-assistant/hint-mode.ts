/**
 * Redaction config — lists of boss names and location names that must never
 * appear in hint output. Quantities are handled dynamically: any (count, noun)
 * pair not present in the player's question is redacted.
 */
export interface RedactionConfig {
  bossNames: string[];
  locations: string[];
}

/**
 * Hint redactor — derives hints from the grounded answer by removing:
 *   1. Boss names (always redacted — spoilers).
 *   2. Locations (always redacted — spoilers).
 *   3. Quantities not mentioned by the player (redacted).
 *
 * No second LLM call. This is a pure redaction of already-grounded text.
 */
export class HintRedactor {
  constructor(private readonly config: RedactionConfig) {}

  redact(answer: string, question: string): string {
    let result = answer;

    // 1. Redact boss names
    for (const boss of this.config.bossNames) {
      const regex = new RegExp(this.escapeRegex(boss), 'gi');
      result = result.replace(regex, '[REDACTED]');
    }

    // 2. Redact locations
    for (const loc of this.config.locations) {
      const regex = new RegExp(this.escapeRegex(loc), 'gi');
      result = result.replace(regex, '[REDACTED]');
    }

    // 3. Redact quantities not mentioned in the player's question
    const questionQuantities = this.extractQuantityCounts(question);
    const answerQuantities = this.extractQuantityPairs(answer);
    for (const { count, noun } of answerQuantities) {
      if (!questionQuantities.includes(count)) {
        const regex = new RegExp(`\\b${count}\\s+${this.escapeRegex(noun)}`, 'gi');
        result = result.replace(regex, '[REDACTED]');
      }
    }

    return result;
  }

  /** Extract just the numbers from the question (quantities the player mentioned). */
  private extractQuantityCounts(text: string): number[] {
    const counts: number[] = [];
    const regex = /(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      counts.push(parseInt(match[1], 10));
    }
    return counts;
  }

  /** Extract (count, noun) pairs from the answer (quantity claims to check). */
  private extractQuantityPairs(text: string): Array<{ count: number; noun: string }> {
    const pairs: Array<{ count: number; noun: string }> = [];
    const regex = /(\d+)\s+([a-z]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      pairs.push({ count: parseInt(match[1], 10), noun: match[2].toLowerCase() });
    }
    return pairs;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
