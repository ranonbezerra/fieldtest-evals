export interface LLMClient {
  generate(question: string, context: string): Promise<string>;
}
