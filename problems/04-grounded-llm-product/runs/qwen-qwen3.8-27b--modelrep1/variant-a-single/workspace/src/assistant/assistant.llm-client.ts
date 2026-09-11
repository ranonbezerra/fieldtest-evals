/**
 * // ASSUMPTION: the task fixes no LLM wire format, so the client interface
 * is a single complete(request) -> { text } call carrying a system and a user
 * prompt; any real provider client can be adapted to it.
 */
export interface LlmRequest {
  /** System prompt, fixed by the service. */
  system: string;
  /** User prompt: wiki pages + player question. */
  prompt: string;
}

export interface LlmCompletion {
  text: string;
}

/** Injectable LLM boundary; the service depends only on this interface. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/**
 * Scripted fake LLM: returns canned text for every request and records each
 * request, so tests can assert on call counts and prompt content.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly nextText: (request: LlmRequest) => string) {}

  complete(request: LlmRequest): Promise<LlmCompletion> {
    this.requests.push(request);
    return Promise.resolve({ text: this.nextText(request) });
  }
}
