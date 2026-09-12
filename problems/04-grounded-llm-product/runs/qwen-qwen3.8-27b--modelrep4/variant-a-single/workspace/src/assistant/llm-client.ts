/** Injection token for the LLM client (see assistant.module.ts). */
export const LLM_CLIENT = 'LLM_CLIENT';

/**
 * Minimal LLM contract. The pipeline treats the model as an untrusted text
 * source: everything it returns must pass the grounding gate before reaching
 * the player.
 */
export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

/**
 * Scripted fake LLM. The script may inspect the prompt, which is how tests
 * prove the service never re-prompts for hint mode.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly promptLog: string[] = [];

  constructor(private readonly script: (prompt: string) => string | Promise<string>) {}

  async complete(prompt: string): Promise<string> {
    this.promptLog.push(prompt);
    return this.script(prompt);
  }

  /** Every prompt this client received, in order (for test assertions). */
  get prompts(): readonly string[] {
    return this.promptLog;
  }
}
