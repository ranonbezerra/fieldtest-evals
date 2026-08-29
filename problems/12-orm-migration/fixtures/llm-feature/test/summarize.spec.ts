import { describe, expect, it } from 'vitest';
import { LocalProviderClient, LocalProviderError } from '../src/llm/local-provider.client.js';
import { SummarizeService } from '../src/llm/summarize.service.js';

function providerYielding(chunks: string[]): LocalProviderClient {
  return {
    async *stream() {
      for (const c of chunks) yield c;
    },
  } as unknown as LocalProviderClient;
}

function providerThrowing(code: 'RATE_LIMITED' | 'TIMEOUT' | 'CONTENT_FILTERED'): LocalProviderClient {
  return {
    async *stream() {
      throw new LocalProviderError(code);
      yield '';
    },
  } as unknown as LocalProviderClient;
}

async function collect(gen: AsyncGenerator<{ text: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of gen) out.push(c.text);
  return out;
}

describe('SummarizeService', () => {
  it('yields the provider chunks in order', async () => {
    const svc = new SummarizeService(providerYielding(['One. ', 'Two. ', 'Three.']));
    expect(await collect(svc.summarize('hello'))).toEqual(['One. ', 'Two. ', 'Three.']);
  });

  it('surfaces a content-filter rejection', async () => {
    const svc = new SummarizeService(providerThrowing('CONTENT_FILTERED'));
    await expect(collect(svc.summarize('hello'))).rejects.toThrow();
  });
});
