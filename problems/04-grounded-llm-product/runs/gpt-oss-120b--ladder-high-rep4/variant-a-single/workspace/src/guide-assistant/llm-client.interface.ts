export interface LLMClient {
  /**
   * Generate a completion for the provided prompt.
   * The implementation can be a real LLM call or a deterministic fake used in tests.
   */
  generate(prompt: string): Promise<string>;
}
