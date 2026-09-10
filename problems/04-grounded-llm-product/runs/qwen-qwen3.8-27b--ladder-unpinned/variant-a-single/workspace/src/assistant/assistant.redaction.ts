import type { GroundedSentence } from './assistant.grounding';

// ASSUMPTION: GroundedSentence is assumed to expose a `text: string` property
// holding the sentence content that passed the grounding gate.

const QUANTITY_PATTERN = /\b(\d+)\s+([a-z]+)\b/g;

/**
 * Redacts a grounded answer into a spoiler-free hint.
 * Removes boss names, item locations, and quantities
 * beyond what the player already mentioned in their question.
 */
export function redactForHint(
  sentences: GroundedSentence[],
  playerQuestion: string,
): string {
  const redacted = sentences.map((s: GroundedSentence): string => {
    let text = s.text;

    // Redact boss / proper-noun subjects that are tied to gameplay-reveal verbs.
    text = text.replace(
      /\b[A-Z]\w*(?:\s+[A-Z]\w*)*\b(?=\s+(?:is|are|has|have|guards|defends|blocks|protects)\b)/g,
      (match: string): string => '[REDACTED]',
    );

    // Redact location phrases.
    text = text.replace(
      /\b(?:in|at|on|near|behind|under|inside|within)\s+\w+(?:\s+\w+)*/g,
      (match: string): string => '[REDACTED]',
    );

    // Redact quantities the player did not already mention.
    text = text.replace(
      QUANTITY_PATTERN,
      (match: string, _num: string, _unit: string): string => {
        if (playerQuestion.includes(match)) {
          return match;
        }
        return '[REDACTED]';
      },
    );

    return text;
  });

  return redacted.join(' ');
}
