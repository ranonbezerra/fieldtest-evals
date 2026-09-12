/** One LLM completion request (system + user prompt). */
export interface LlmRequest {
  system: string;
  user: string;
}

/** Injectable boundary between the pipeline and any LLM backend. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

/** DI token; a string token keeps constructor injection metadata-free under ESM. */
export const LLM_CLIENT = 'LLM_CLIENT';

/**
 * Deterministic scripted fake. Replies come from a provided function, which is
 * enough to drive the pipeline, hint mode, and the eval harness. Records every
 * call so tests can assert the hint was never produced by re-prompting.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly reply: (request: LlmRequest) => string) {}

  async complete(request: LlmRequest): Promise<string> {
    this.calls.push(request);
    return this.reply(request);
  }
}
