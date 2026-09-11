/**
 * Domain errors. The global exception filter maps these onto the single error
 * envelope: { error: { code, message, details } }. `code` is the contract.
 */
export class AnchorDomainError extends Error {
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

export class CanonicalizationError extends AnchorDomainError {
  constructor(message: string) {
    super('invalid_content', 400, message);
  }
}

export class AlreadyAnchoredError extends AnchorDomainError {
  constructor(documentId: string, version: number, existing: { txId: string; status: string } | null) {
    super(
      'already_anchored',
      409,
      `an anchor already exists for document "${documentId}" version ${version}`,
      existing
        ? { documentId, version, existingTxId: existing.txId, existingStatus: existing.status }
        : { documentId, version },
    );
  }
}

/** Raised by the repository when the unique constraint rejects a duplicate. */
export class DuplicateAnchorError extends AnchorDomainError {
  constructor(documentId: string, version: number) {
    super('already_anchored', 409, `the database rejected a duplicate anchor for document "${documentId}" version ${version}`);
  }
}
