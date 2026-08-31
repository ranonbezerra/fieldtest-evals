import type { GroundedAnswer } from "./grounding.js";
import { tokenSet } from "./grounding.js";

export interface HintConfig {
  redactTokens: string[];
  playerMentioned: string[];
}

const REDACTED = "[REDACTED]";
const TOKEN_PATTERN = /[a-z0-9]+/gi;

export function redactToHint(grounded: GroundedAnswer, config: HintConfig): string {
  if (grounded.refused) {
    return grounded.text;
  }

  const redactSet = new Set<string>(config.redactTokens.map((token) => token.toLowerCase()));
  const mentionedSet = new Set<string>(config.playerMentioned.map((token) => token.toLowerCase()));

  const keptSentences: string[] = [];

  for (const sentence of grounded.sentences) {
    const redactedSentence = sentence.replace(TOKEN_PATTERN, (match) => {
      const token = match.toLowerCase();
      const isQuantityToken = /^[0-9]+$/.test(token);

      if ((redactSet.has(token) || isQuantityToken) && !mentionedSet.has(token)) {
        return REDACTED;
      }

      return match;
    });

    const remainingContent = tokenSet(redactedSentence.replaceAll(REDACTED, " "));
    if (remainingContent.size > 0) {
      keptSentences.push(redactedSentence);
    }
  }

  return keptSentences.join(" ");
}
