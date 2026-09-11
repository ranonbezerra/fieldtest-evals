/**
 * The LLM client is the single seam to the model. Tests and the eval harness
 * inject the scripted fake; the fake returns one specific reply per scenario
 * so a confident lie can be planted deterministically. No network in tests.
 */

/** The single refusal phrase used by the prompt, the gate, and the eval judges. */
export const REFUSAL = 'not covered by my sources';

export interface LlmReply {
  /** Case-insensitive substring of the prompt that routes to this reply. */
  when: string;
  reply: string;
}

export interface LlmScript {
  replies: LlmReply[];
  /** Returned when no reply matches. Defaults to '' which the gate turns into a refusal. */
  fallback?: string;
}

export abstract class LlmClient {
  abstract complete(prompt: string): Promise<string>;
}

// ASSUMPTION: no live model provider is reachable in this environment, so the
// module default is the scripted client with an empty reply (the grounding
// gate then refuses). A real provider-backed client is injected at deployment.
export class ScriptedLlmClient implements LlmClient {
  /** Every prompt received, in order. Lets tests prove how many LLM calls an answer cost. */
  readonly prompts: string[] = [];

  constructor(private readonly script: LlmScript = { replies: [] }) {}

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const haystack = prompt.toLowerCase();
    const hit = this.script.replies.find(reply => haystack.includes(reply.when.toLowerCase()));
    return hit ? hit.reply : (this.script.fallback ?? '');
  }
}

export function buildPrompt(question: string, sources: string[]): string {
  const pages = sources.map((page, index) => `--- page ${index + 1} ---\n${page}`).join('\n\n');
  return (
    `Answer the player's question using only the wiki pages below. ` +
    `If the pages do not contain the answer, reply exactly: ${REFUSAL}\n\n` +
    `Player question: ${question}\n\n` +
    `Wiki pages:\n${pages}`
  );
}
