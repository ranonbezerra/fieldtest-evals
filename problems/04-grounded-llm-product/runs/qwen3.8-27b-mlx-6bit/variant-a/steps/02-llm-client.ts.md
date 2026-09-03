# 02-llm-client.ts

## reasoning

```
Let me look at what the plan specifies for `src/llm-client.ts`:

```ts
export interface LLMClient {
  generate(prompt: string): Promise<string>;
}

/** Scripted fake. Returns the string given at construction, or throws if called more than `replies` times. */
export declare class ScriptedLLMClient implements LLMClient {
  constructor(replies: string[]);
  generate(prompt: string): Promise<string>;
}

/** Error: `ScriptedLLMClient` throws `Error("ScriptedLLMClient exhausted")` if `generate` is called after all replies are consumed. */
```

So I need to implement:
1. `LLMClient` interface with a `generate(prompt: string): Promise<string>` method.
2. `ScriptedLLMClient` class that implements `LLMClient`:
   - Constructor takes `replies: string[]`
   - `generate` returns the next reply from the list (sequentially)
   - Throws `Error("ScriptedLLMClient exhausted")` if called after all replies are consumed

The plan uses `declare class` in the signature section, but that's just the type declaration. I need to write the actual implementation.

Let me think about the behavior:
- Constructor receives an array of strings (replies)
- Each call to `generate` returns the next string in the array
- Once all strings are consumed, subsequent calls throw `Error("ScriptedLLMClient exhausted")`

This is straightforward. Let me write it.
```

## reply

```ts
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
```
