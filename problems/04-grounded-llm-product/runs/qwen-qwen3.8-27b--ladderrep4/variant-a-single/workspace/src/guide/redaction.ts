import type { Span } from './text-utils';
import { properNounSpans, quantityKey, quantityMatches } from './text-utils';

/** The placeholder that redaction leaves in place of a removed span. */
export const REDACTED = '[redacted]';

/**
 * Hint mode: derive the spoiler-free hint by redacting an answer that has
 * already passed the grounding gate. No LLM call here — redaction cannot
 * invent; a second generation can.
 *
 * What goes: boss names and locations (proper-noun runs, always) and
 * quantities the player has not already mentioned in the question.
 */
export function redactForHint(answer: string, question: string): string {
  let out = redactUnmentionedQuantities(answer, question);
  out = replaceSpans(out, properNounSpans(out));
  return collapsePlaceholders(out);
}

function redactUnmentionedQuantities(answer: string, question: string): string {
  const allowed = new Set(quantityMatches(question).map(quantityKey));
  const spans = quantityMatches(answer)
    .filter((quantity) => !allowed.has(quantityKey(quantity)))
    .map(({ start, end }) => ({ start, end }));
  return replaceSpans(answer, spans);
}

function replaceSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // defensive: skip overlapping spans
    out += text.slice(cursor, span.start) + REDACTED;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

function collapsePlaceholders(text: string): string {
  return text.replace(/(\[redacted]\s+)+\[redacted\]/g, REDACTED);
}
