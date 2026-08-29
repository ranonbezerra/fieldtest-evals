/**
 * Client for the local inference server. Streams over chunked HTTP.
 *
 * The server tokenizes on grapheme boundaries, so a chunk never splits a
 * multi-byte character. Callers concatenate chunks directly.
 */
export type LocalErrorCode = 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_FILTERED' | 'INTERNAL';

export class LocalProviderError extends Error {
  constructor(public readonly code: LocalErrorCode) {
    super(code);
  }
}

export interface LocalCompletionRequest {
  prompt: string;
  maxTokens: number;
}

export class LocalProviderClient {
  constructor(private readonly baseUrl: string) {}

  /** Yields text chunks in order. Throws `LocalProviderError` on failure. */
  async *stream(req: LocalCompletionRequest): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: req.prompt, max_tokens: req.maxTokens }),
    });

    if (res.status === 429) throw new LocalProviderError('RATE_LIMITED');
    if (res.status === 408) throw new LocalProviderError('TIMEOUT');
    if (res.status === 451) throw new LocalProviderError('CONTENT_FILTERED');
    if (!res.ok) throw new LocalProviderError('INTERNAL');

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value);
    }
  }
}
