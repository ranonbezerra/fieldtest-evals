/**
 * A domain error that maps 1:1 onto the API error envelope
 * `{ "error": { "code", "message", "details" } }`. `code` is the contract.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
