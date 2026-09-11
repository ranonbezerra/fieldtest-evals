import type { AnswerMode, AnswerResult, WikiPage } from './assistant.types';
import { REFUSAL_TEXT } from './assistant.types';
import type { LlmClient } from './assistant.llm-client';
import { checkGrounding, splitSentences } from './assistant.grounding';
import { EMPTY_SPOILER_LEXICON, redactForHint } from './assistant.redactor';
import type { SpoilerLexicon } from './assistant.redactor';

const SYSTEM_PROMPT = [
  'You are a game guide assistant.',
  'Answer the player using ONLY the provided wiki pages: same facts, same quantities, same names.',
  `If the wiki pages do not contain the answer, reply with exactly: ${REFUSAL_TEXT}`,
].join(' ');

/**
 * The answer pipeline:
 *   model -> sentence-level grounding gate -> (hint mode) spoiler redaction.
 *
 * Both modes make exactly one LLM call; the hint is derived by redacting the
 * full grounded answer, never by re-prompting the model.
 */
export class AssistantService {
  constructor(
    private readonly llm: LlmClient | undefined,
    private readonly lexicon: SpoilerLexicon = EMPTY_SPOILER_LEXICON,
  ) {}

  async answer(question: string, sources: WikiPage[], mode: AnswerMode = 'full'): Promise<AnswerResult> {
    if (this.llm === undefined) {
      throw new Error('AssistantService: no LlmClient was injected');
    }
    const raw = (
      await this.llm.complete({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(question, sources),
      })
    ).text;

    const verdicts = splitSentences(raw).map((sentence) => checkGrounding(sentence, sources));
    const kept = verdicts.filter((v) => v.grounded).map((v) => v.sentence);
    const dropped = verdicts.filter((v) => !v.grounded).map((v) => v.sentence);

    if (kept.length === 0) {
      return { mode, text: REFUSAL_TEXT, modelText: raw, refused: true, dropped };
    }

    let text = kept.join(' ');
    if (mode === 'hint') {
      text = redactForHint(text, question, this.lexicon);
    }
    return { mode, text, modelText: raw, refused: false, dropped };
  }
}

function buildPrompt(question: string, sources: WikiPage[]): string {
  const pages = sources.map((page) => `--- ${page.title} ---\n${page.text}`).join('\n\n');
  return [
    'Wiki pages:',
    pages,
    '',
    `Player question: ${question}`,
    'Answer the question using only the wiki pages above.',
  ].join('\n');
}
