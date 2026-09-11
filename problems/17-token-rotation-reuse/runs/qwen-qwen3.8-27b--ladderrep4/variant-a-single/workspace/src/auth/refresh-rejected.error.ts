const REFRESH_REJECTED_MESSAGE = 'Refresh token is invalid or has expired.';

/**
 * The single rejection for POST /auth/refresh. Malformed, unknown, expired and
 * reuse all surface as this one error so the response is identical; the audit
 * record carries the real cause.
 */
export class RefreshRejectedError extends Error {
  readonly status = 401;
  readonly code = 'refresh_rejected';
  readonly message = REFRESH_REJECTED_MESSAGE;
  readonly details: Record<string, never> = {};

  constructor() {
    super(REFRESH_REJECTED_MESSAGE);
    this.name = 'RefreshRejectedError';
  }
}
