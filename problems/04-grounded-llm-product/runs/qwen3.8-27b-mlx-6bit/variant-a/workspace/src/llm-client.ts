export interface LlmClient {
  generate(prompt: string, context: string[]): Promise<string>;
}
