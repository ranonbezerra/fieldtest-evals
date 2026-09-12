import type { LlmClient, LlmPrompt } from './guide.types.js';

export interface ScriptEntry {
  /** Matched against the prompt's question (substring or regex). */
  match: RegExp | string;
  /** The exact text the fake model "generates". */
  reply: string;
}

/**
 * Deterministic stand-in for a real LLM: returns the first scripted reply
 * whose match hits the question and fails loudly otherwise. Records every
 * prompt so tests can assert how many times the model was actually called.
 */
export class ScriptedLlmClient implements LlmClient {
  private readonly prompts: LlmPrompt[] = [];

  constructor(private readonly script: ScriptEntry[]) {}

  async complete(prompt: LlmPrompt): Promise<string> {
    this.prompts.push(prompt);
    const entry = this.script.find((e) =>
      typeof e.match === 'string'
        ? prompt.question.toLowerCase().includes(e.match.toLowerCase())
        : e.match.test(prompt.question),
    );
    if (!entry) {
      throw new Error(`ScriptedLlmClient: no scripted reply for question "${prompt.question}"`);
    }
    return entry.reply;
  }

  get callCount(): number {
    return this.prompts.length;
  }
}
