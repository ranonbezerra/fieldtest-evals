export interface LLMClient {
  generate(prompt: string): Promise<string>;
}

export class ScriptedLLMClient implements LLMClient {
  private readonly replies: string[];
  private index: number;

  constructor(replies: string[]) {
    this.replies = [...replies];
    this.index = 0;
  }

  async generate(_prompt: string): Promise<string> {
    if (this.index >= this.replies.length) {
      throw new Error("ScriptedLLMClient exhausted");
    }
    return this.replies[this.index++];
  }
}
