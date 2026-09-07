import { DocumentNotFoundError } from '../errors.js';
import type { DocumentSource } from './document-source.js';

/** In-memory document store used as the default provider and in tests. */
export class FakeDocumentSource implements DocumentSource {
  private readonly documents = new Map<string, Record<string, unknown>>();

  set(documentId: string, version: number, content: Record<string, unknown>): void {
    this.documents.set(this.key(documentId, version), structuredClone(content));
  }

  async get(documentId: string, version: number): Promise<Record<string, unknown>> {
    const content = this.documents.get(this.key(documentId, version));
    if (!content) throw new DocumentNotFoundError(documentId, version);
    return structuredClone(content);
  }

  private key(documentId: string, version: number): string {
    return `${documentId}#${version}`;
  }
}
