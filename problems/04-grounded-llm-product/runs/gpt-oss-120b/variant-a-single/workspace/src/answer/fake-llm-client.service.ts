import { Injectable } from '@nestjs/common';
import { LLMClient } from './llm-client.interface';

/**
 * A very simple scripted fake LLM client.
 *
 * The `responses` map is keyed by the exact prompt that will be passed by the
 * AnswerService.  In tests we initialise the client with the expected prompt →
 * response pairs.
 */
@Injectable()
export class FakeLLMClient implements LLMClient {
  private readonly responses: Map<string, string>;

  constructor(responses?: Map<string, string>) {
    this.responses = responses ?? new Map();
  }

  /**
   * Register a response for a specific prompt (used by tests).
   */
  addResponse(prompt: string, answer: string) {
    this.responses.set(prompt, answer);
  }

  async generate(prompt: string): Promise<string> {
    if (this.responses.has(prompt)) {
      return this.responses.get(prompt)!;
    }
    // Default fallback – useful for ad‑hoc debugging.
    return 'not covered by my sources';
  }
}
