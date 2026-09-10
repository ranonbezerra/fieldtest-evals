/**
 * Errors carrying an API contract. Each maps directly onto the single error
 * envelope: a snake_case `code` (the contract), a developer-facing `message`,
 * and `details` (an object, never null).
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AlreadyAnchoredError extends DomainError {
  constructor(
    documentId: string,
    version: number,
    existingTxId: string,
    existingStatus: string,
  ) {
    super(
      'already_anchored',
      409,
      `Document ${documentId} version ${version} is already anchored; exactly one anchor per (document, version) is enforced by the database. Republish the change as a new version instead.`,
      { documentId, version, existingTxId, existingStatus },
    );
  }
}

export class InvalidContentError extends DomainError {
  constructor(reason: string) {
    super(
      'invalid_content',
      400,
      `Report content is not canonicalizable: ${reason}`,
      { reason },
    );
  }
}

export class BroadcastRejectedError extends DomainError {
  constructor(txId: string, reason: string) {
    super(
      'broadcast_rejected',
      502,
      `The chain node definitively rejected the anchor transaction: ${reason}`,
      { txId, reason },
    );
  }
}
