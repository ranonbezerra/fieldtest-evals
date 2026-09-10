import { DomainError } from '../common/domain-error.js';

// ASSUMPTION: anchorDocument(documentId, version) takes no content argument, so
// the structured content must come from somewhere the task does not specify
// (no report store is part of this build). It is therefore injected as this
// port; the in-memory stand-in below wires this self-contained build, and the
// platform's report store implements the same contract in production.
export const DOCUMENT_CONTENT = 'DOCUMENT_CONTENT';

export interface DocumentContentProvider {
  /**
   * Returns the structured JSON content of a published report version.
   * The structured JSON is the source of truth; the PDF is only a rendering.
   * @throws DocumentVersionNotFoundError when no published content exists for the (document, version).
   */
  getContent(documentId: string, version: number): Promise<unknown>;
}

export class DocumentVersionNotFoundError extends DomainError {
  constructor(documentId: string, version: number) {
    super(
      'resource_not_found',
      404,
      `No published report content for document ${documentId}, version ${version}`,
      { documentId, version },
    );
  }
}

/** Development stand-in for the report store (see the assumption above). */
export class InMemoryDocumentContentProvider implements DocumentContentProvider {
  private readonly content = new Map<string, unknown>();

  publish(documentId: string, version: number, content: unknown): void {
    this.content.set(key(documentId, version), content);
  }

  async getContent(documentId: string, version: number): Promise<unknown> {
    const value = this.content.get(key(documentId, version));
    if (value === undefined) throw new DocumentVersionNotFoundError(documentId, version);
    return value;
  }
}

function key(documentId: string, version: number): string {
  return `${documentId}@${version}`;
}
