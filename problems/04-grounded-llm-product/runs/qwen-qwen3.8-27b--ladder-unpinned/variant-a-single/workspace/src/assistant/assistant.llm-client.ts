/**
 * The LLM boundary. Production code depends only on the LlmClient interface;
 * tests and the eval harness inject ScriptedLlmClient, so no network is
 * touched and a specific answer (including a planted confident lie) can be
 * returned per scenario.
 */

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

/** DI token for the LLM client. */
export const LLM_CLIENT = 'LLM_CLIENT';

/**
 * Scriptable fake LLM. It replays the scripted replies in order and throws on
 * any call beyond the script, so a code path that sneaks in a second
 * generation (e.g. a re-prompted hint mode) fails loudly.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly scripted: string[];
  private readonly prompts: string[] = [];

  constructor(scripted: string[] = []) {
    this.scripted = [...scripted];
  }

  /** Number of LLM calls completed so far. */
  get callCount(): number {
    return this.prompts.length;
  }

  /** The prompts this client was asked to complete, in order. */
  get sentPrompts(): string[] {
    return [...this.prompts];
  }

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const next = this.scripted.shift();
    if (next === undefined) {
      throw new Error(`ScriptedLlmClient: no scripted response for LLM call #${this.callCount}`);
    }
    return next;
  }
}
