import { LLMClient } from "./llm-client.interface.js";
import { groundAnswer } from "./grounding.gate.js";
import { redactForHint } from "./hint.redactor.js";

export type Mode = "normal" | "hint";

export type AnswerResult =
  | { status: "answered"; content: string }
  | { status: "hint"; content: string }
  | { status: "refused"; message: "not covered by my sources" };

/**
 * Answer pipeline:
 *   1. Call the injectable LLM client.
 *   2. Sentence-level grounding gate.
 *   3. Refuse when nothing survives.
 *   4. Redact for hint mode.
 */
export class AnswerService {
  constructor(private readonly llm: LLMClient) {}

  async answer(
    question: string,
    sources: string[],
    mode: Mode,
  ): Promise<AnswerResult> {
    const context = sources.join("\n");
    const raw = await this.llm.generate(question, context);
    const grounded = groundAnswer(raw, sources);

    if (grounded === null) {
      return { status: "refused", message: "not covered by my sources" };
    }

    if (mode === "hint") {
      return { status: "hint", content: redactForHint(grounded, question) };
    }

    return { status: "answered", content: grounded };
  }
}
