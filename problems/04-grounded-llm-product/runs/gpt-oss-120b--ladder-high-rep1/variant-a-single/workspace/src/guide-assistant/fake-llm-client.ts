import { LLMClient } from './llm-client.interface';

/**
 * A deterministic fake LLM client used in tests.
 * It always returns the answer that was passed to the constructor.
 */
export class FakeLLMClient implements LLMClient {
  private readonly answer: string;

  constructor(answer: string) {
    this.answer = answer;
  }

  async generate(_question: string, _sources: string[]): Promise<string> {
    return this.answer;
  }
}
