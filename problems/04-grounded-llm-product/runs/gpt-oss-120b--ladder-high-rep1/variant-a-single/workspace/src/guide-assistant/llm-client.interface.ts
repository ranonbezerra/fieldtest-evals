export interface LLMClient {
  /**
   * Generates a raw answer given a user question and the retrieved source texts.
   * In production this would call a real LLM; in tests a scripted fake is used.
   */
  generate(question: string, sources: string[]): Promise<string>;
}
