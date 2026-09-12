import { DocumentNotFoundError } from './anchor.errors.js';

// ASSUMPTION: the structured report content (the JSON source of truth; the
// PDF is only a rendering) lives in the platform's document store, which is
// out of scope for this feature. Anchoring only needs read access to the
// published content of a (documentId, version), so it is abstracted behind
// this interface.
export interface DocumentContentSource {
  get(documentId: string, version: string): Promise<unknown>;
}

/** DI token for the document content source. */
export const DOCUMENT_CONTENT_SOURCE = 'ANCHOR_DOCUMENT_CONTENT_SOURCE';

/** In-process document store, empty by default; the platform store overrides this. */
export class InMemoryDocumentContentSource implements DocumentContentSource {
  constructor(private readonly contentByRef: ReadonlyMap<string, unknown> = new Map()) {}

  async get(documentId: string, version: string): Promise<unknown> {
    const content = this.contentByRef.get(`${documentId}@${version}`);
    if (content === undefined) {
      throw new DocumentNotFoundError(documentId, version);
    }
    return content;
  }
}
