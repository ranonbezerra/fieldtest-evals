/**
 * Transport-agnostic LLM boundary. Any implementation (a real provider
 * client, or the scripted fake below) can be injected into AnswerService.
 */

export interface LlmRequest {
  system: string;
  prompt: string;
}

export interface LlmCompletion {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/** Deterministic fake: returns a scripted reply and records every request. */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];

  constructor(private readonly reply: (request: LlmRequest) => string) {}

  static fromText(text: string): ScriptedLlmClient {
    return new ScriptedLlmClient(() => text);
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    return { text: this.reply(request) };
  }
}
