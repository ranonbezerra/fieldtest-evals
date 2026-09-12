/**
 * Domain errors carrying a stable `code` (the contract) and an HTTP status.
 * The global filter renders every error as the single envelope:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `message` is developer-facing English; `details` is always an object.
 */
export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainException';
  }
}

export const validationError = (message: string, details: Record<string, unknown> = {}): DomainException =>
  new DomainException('validation_error', message, 400, details);

export const documentVersionNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'document_version_not_found',
    `document ${documentId} version ${version} was not issued`,
    404,
    { documentId, version },
  );

export const documentVersionConflictError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'document_version_conflict',
    `document ${documentId} version ${version} was already issued`,
    409,
    { documentId, version },
  );

export const anchorNotFoundError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'anchor_not_found',
    `no anchor exists for document ${documentId} version ${version}`,
    404,
    { documentId, version },
  );

export const anchorConflictError = (documentId: string, version: number): DomainException =>
  new DomainException(
    'anchor_conflict',
    `an anchor already exists for document ${documentId} version ${version}`,
    409,
    { documentId, version },
  );

export const invalidAnchorContentError = (reason: string): DomainException =>
  new DomainException('invalid_anchor_content', `report content cannot be anchored: ${reason}`, 422, { reason });
