export interface LLMClient {
  generate(question: string, sources: string[], mode: 'answer' | 'hint'): Promise<string>;
}
