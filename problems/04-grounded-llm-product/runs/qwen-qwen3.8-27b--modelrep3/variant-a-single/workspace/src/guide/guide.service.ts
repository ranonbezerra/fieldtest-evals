import { REFUSAL_MESSAGE } from './guide.types.js';
import type { AnswerMode, GuideAnswer, LlmClient, WikiSource } from './guide.types.js';
import { isSentenceGrounded, splitSentences } from './grounder.js';
import { redactToHint } from './redactor.js';

/**
 * Answer pipeline: one LLM call, sentence-level grounding gate, optional
 * spoiler-free redaction for hint mode. All business logic lives here; the
 * LLM client is injected and only produces raw text.
 */
export class GuideService {
  constructor(private readonly llm: LlmClient) {}

  async answer(question: string, sources: WikiSource[], mode: AnswerMode = 'full'): Promise<GuideAnswer> {
    if (sources.length === 0) {
      // No pages, no ground truth: refuse without consulting the model.
      return {
        status: 'refused',
        mode,
        text: '',
        refusalReason: REFUSAL_MESSAGE,
        droppedSentences: [],
        sourcesUsed: [],
      };
    }

    // Exactly one model call per answer, in both modes: the prompt carries no
    // mode, and hint mode is post-processing, never a re-prompt.
    const raw = await this.llm.complete({ question, sources });
    const sentences = splitSentences(raw);

    const kept: string[] = [];
    const dropped: string[] = [];
    const sourcesUsed = new Set<string>();

    for (const sentence of sentences) {
      const verdict = isSentenceGrounded(sentence, sources);
      if (verdict.grounded) {
        kept.push(sentence);
        for (const source of sources) {
          if (isSentenceGrounded(sentence, [source]).grounded) sourcesUsed.add(source.id);
        }
      } else {
        dropped.push(sentence);
      }
    }

    if (kept.length === 0) {
      return {
        status: 'refused',
        mode,
        text: '',
        refusalReason: REFUSAL_MESSAGE,
        droppedSentences: dropped,
        sourcesUsed: [],
      };
    }

    const fullText = kept.join(' ');
    return {
      status: 'answered',
      mode,
      text: mode === 'hint' ? redactToHint(fullText, question) : fullText,
      refusalReason: null,
      droppedSentences: dropped,
      sourcesUsed: [...sourcesUsed],
    };
  }
}
