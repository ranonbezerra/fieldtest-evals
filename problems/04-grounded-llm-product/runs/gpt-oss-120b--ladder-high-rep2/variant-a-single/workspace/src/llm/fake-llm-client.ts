import { LLMClient } from './llm-client.interface.js';

/**
 * A deterministic, scriptable fake LLM client for tests.
 *
 * The client stores a map from a key (normally the question text) to the answer
 * it should return. When `generateAnswer` is called it looks for the first key
 * that appears in the prompt and returns the associated answer.
 */
export class FakeLLMClient implements LLMClient {
  public readonly answerMap: Map<string, string>;

  constructor(initialMap?: Map<string, string>) {
    this.answerMap = initialMap ?? new Map<string, string>();
  }

  async generateAnswer(prompt: string): Promise<string> {
    for (const [key, answer] of this.answerMap.entries()) {
      if (prompt.includes(key)) {
        return answer;
      }
    }
    // No mapping – return empty string so the service will treat it as no grounded content.
    return '';
  }
}
