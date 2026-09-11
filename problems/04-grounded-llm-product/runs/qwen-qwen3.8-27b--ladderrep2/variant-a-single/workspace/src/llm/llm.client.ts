/**
 * Minimal LLM client contract. The answer pipeline depends only on this
 * interface; tests use ScriptedLlmClient so no network is involved and a
 * confident lie can be planted per scenario.
 */

export interface LlmRequest {
  prompt: string;
}

export interface LlmResponse {
  text: string;
}

export interface LlmClient {
  complete(request: LlmRequest): LlmResponse;
}

export interface ScriptedReply {
  /** Substring of the prompt (usually the player question) that selects this reply. */
  match: string;
  reply: string;
}

/** Deterministic fake: returns the scripted reply whose match appears in the prompt. */
export class ScriptedLlmClient implements LlmClient {
  constructor(
    private readonly scripts: readonly ScriptedReply[],
    private readonly fallback: string = '',
  ) {}

  complete(request: LlmRequest): LlmResponse {
    const hit = this.scripts.find((s) => request.prompt.includes(s.match));
    return { text: hit ? hit.reply : this.fallback };
  }
}
