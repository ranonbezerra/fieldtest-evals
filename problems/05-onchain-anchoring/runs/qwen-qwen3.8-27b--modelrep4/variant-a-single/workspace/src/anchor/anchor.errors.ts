import { ApiException } from '../common/api-exception.js';

export class AnchorBadRequestError extends ApiException {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'bad_request', message, details);
  }
}

export class DocumentNotFoundError extends ApiException {
  constructor(documentId: string, version: string) {
    super(
      404,
      'document_not_found',
      `no structured report content for document "${documentId}" version "${version}"`,
      { documentId, version },
    );
  }
}

export class AnchorNotFoundError extends ApiException {
  constructor(documentId: string, version: string) {
    super(
      404,
      'anchor_not_found',
      `no anchor exists for document "${documentId}" version "${version}"`,
      { documentId, version },
    );
  }
}

export class AnchorConflictError extends ApiException {
  constructor(documentId: string, version: string, computedHash: string, anchoredHash: string) {
    super(
      409,
      'anchor_conflict',
      `document "${documentId}" version "${version}" is already anchored with different content`,
      { documentId, version, computedHash, anchoredHash },
    );
  }
}

/**
 * Domain signal (not an HTTP error): the schema-level unique constraint
 * rejected a second anchor for the same (document, version).
 */
export class AnchorAlreadyExistsError extends Error {
  constructor(readonly documentId: string, readonly version: string) {
    super(`anchor already exists for document "${documentId}" version "${version}"`);
    this.name = 'AnchorAlreadyExistsError';
  }
}
