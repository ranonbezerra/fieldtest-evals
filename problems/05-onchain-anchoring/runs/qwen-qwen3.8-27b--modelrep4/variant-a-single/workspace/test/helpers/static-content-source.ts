import type { DocumentContentSource } from '../../src/anchor/document-content-source.js';

/** Content source that serves one fixed document content. */
export class StaticContentSource implements DocumentContentSource {
  constructor(private readonly content: unknown) {}

  async get(): Promise<unknown> {
    return this.content;
  }
}
