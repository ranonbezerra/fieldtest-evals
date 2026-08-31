import type { LlmClient } from "./llm-client.js";

export class ScriptedLlm implements LlmClient {
  private readonly responses: Map<string, string>;

  constructor(responses: Map<string, string>) {
    this.responses = responses;
  }

  async generate(prompt: string, _context: string[]): Promise<string> {
    const response = this.responses.get(prompt);

    if (response === undefined) {
      throw new Error(`No scripted response registered for prompt: ${prompt}`);
    }

    return response;
  }
}
