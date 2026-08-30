export type ErrorCode =
  | 'insufficient_funds'
  | 'duplicate_idempotency_key'
  | 'resource_not_found'
  | 'invalid_request';

export class PayoutError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
    this.details = details ?? {};
  }
}
