import type { AnswerMode } from './answer-result.js';

/** DI token for the LLM client — the only model seam the pipeline depends on. */
export const LLM_CLIENT = 'GUIDE_LLM_CLIENT';

export interface LlmRequest {
  question: string;
  sources: string[];
  mode: AnswerMode;
}

/**
 * Injectable LLM client. A production deployment wires a real client under
 * LLM_CLIENT; tests use ScriptedLlmClient so a specific answer per scenario —
 * including a confident lie — can be planted. No network in tests.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/**
 * Scriptable fake. Returns the canned answer for the scenario (keyed by
 * question), or the supplied function's answer. Throws on unknown questions
 * so a mis-planted script fails loudly instead of scoring a refusal by accident.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(
    private readonly script: Record<string, string> | ((request: LlmRequest) => string),
  ) {}

  async complete(request: LlmRequest): Promise<string> {
    this.calls.push(request);
    const answer =
      typeof this.script === 'function' ? this.script(request) : this.script[request.question];
    if (answer === undefined) {
      throw new Error(
        `ScriptedLlmClient: no scripted answer for question "${request.question}"`,
      );
    }
    return answer;
  }
}

// ASSUMPTION: the task specifies no production LLM backend, so the module
// ships this refusing default under LLM_CLIENT and the app wires without a
// network dependency; a real or scripted client is provided against the same token.
export class NoOpLlmClient implements LlmClient {
  async complete(): Promise<string> {
    throw new Error('No LLM client configured: provide one under the LLM_CLIENT token.');
  }
}
