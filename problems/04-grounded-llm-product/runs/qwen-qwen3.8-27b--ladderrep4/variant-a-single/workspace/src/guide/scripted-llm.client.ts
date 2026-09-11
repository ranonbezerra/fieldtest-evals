import type { LlmClient, LlmRequest } from './answer.types';

/**
 * A deterministic LLM stand-in for tests and local runs. It returns the
 * scripted answer for the exact question it was given, so a confident lie can
 * be planted per scenario. Unknown questions throw: a silent default would
 * hide a wiring bug.
 */
export class ScriptedLlmClient implements LlmClient {
  constructor(private readonly script: Record<string, string>) {}

  async complete(request: LlmRequest): Promise<string> {
    const scripted = this.script[request.question];
    if (scripted === undefined) {
      throw new Error(`ScriptedLlmClient: no scripted answer for question "${request.question}"`);
    }
    return scripted;
  }
}
