import { ContentRejectedError, SummarizeService } from './summarize.service.js';

export interface SseSink {
  write(event: string, data: unknown): void;
  status(code: number): void;
  end(): void;
}

/**
 * `POST /summaries` — server-sent events.
 *
 * Emits one `chunk` event per provider chunk, then a terminal `done` event
 * carrying the full text. The web client renders chunks as they arrive for
 * the typing effect, and then replaces what it rendered with `done.text`,
 * which is the value it stores and copies.
 */
export class SummarizeController {
  constructor(private readonly summaries: SummarizeService) {}

  async create(body: { text: string }, sse: SseSink): Promise<void> {
    let full = '';
    try {
      for await (const chunk of this.summaries.summarize(body.text)) {
        full += chunk.text;
        sse.write('chunk', { text: chunk.text });
      }
      sse.write('done', { text: full, chars: full.length });
      sse.end();
    } catch (e) {
      if (e instanceof ContentRejectedError) {
        sse.status(422);
        sse.write('error', { code: 'content_rejected' });
        sse.end();
        return;
      }
      sse.status(500);
      sse.write('error', { code: 'internal' });
      sse.end();
    }
  }
}
