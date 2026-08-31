# 01-llm-client.ts

## reasoning

```
We need answer user: write exactly one file src/llm-client.ts complete inside fenced block, nothing else. Need follow plan. File is LlmClient interface only.

Plan section 3:
```ts
// src/llm-client.ts
export interface LlmClient {
  generate(prompt: string, context: string[]): Promise<string>;
}
```
Need maybe include no extra exports. TypeScript strict. Could just that. Need ensure no other content. Fenced block only.

Need consider ESM? Interface export fine. No imports. Maybe add JSDoc? Plan says implement exactly, no extra feature. Comments okay? But likely minimal.

Final:
```ts
export interface LlmClient {
  generate(prompt: string, context: string[]): Promise<string>;
}
```

Ensure only fenced block. No explanation.
```

## reply

```ts
export interface LlmClient {
  generate(prompt: string, context: string[]): Promise<string>;
}
```
