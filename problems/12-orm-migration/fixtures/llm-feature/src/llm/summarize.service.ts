import { LocalProviderClient, LocalProviderError } from './local-provider.client.js';

export const FALLBACK_TEXT = 'Summary unavailable right now. Please try again shortly.';
export const MAX_INPUT_CHARS = 12_000;
export const MAX_TOKENS = 512;

export class ContentRejectedError extends Error {
  constructor() {
    super('content_rejected');
  }
}

export interface SummaryChunk {
  text: string;
}

export class SummarizeService {
  constructor(private readonly provider: LocalProviderClient) {}

  private prompt(text: string): string {
    const clipped = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
    return `Summarize the following in three sentences, then list up to five tags.\n\n${clipped}`;
  }

  /**
   * Yields the summary in chunks, in order.
   *
   * On a timeout the provider is retried once. If it times out again, the
   * fallback text is yielded as a single chunk and the request is considered
   * successful -- the client renders it like any other summary.
   *
   * A content-filter rejection is not recoverable and surfaces to the caller.
   */
  async *summarize(text: string): AsyncGenerator<SummaryChunk> {
    const req = { prompt: this.prompt(text), maxTokens: MAX_TOKENS };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        for await (const chunk of this.provider.stream(req)) {
          yield { text: chunk };
        }
        return;
      } catch (e) {
        if (!(e instanceof LocalProviderError)) throw e;

        if (e.code === 'CONTENT_FILTERED') throw new ContentRejectedError();

        if (e.code === 'TIMEOUT' || e.code === 'RATE_LIMITED') {
          if (attempt === 0) continue;
          yield { text: FALLBACK_TEXT };
          return;
        }

        throw e;
      }
    }
  }
}
