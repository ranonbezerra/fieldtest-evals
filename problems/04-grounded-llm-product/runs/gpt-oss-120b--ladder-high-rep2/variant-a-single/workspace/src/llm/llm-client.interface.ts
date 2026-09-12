export interface LLMClient {
  /**
   * Generates an answer based on the provided prompt.
   *
   * @param prompt - The full prompt that includes the user question and the sources.
   */
  generateAnswer(prompt: string): Promise<string>;
}
