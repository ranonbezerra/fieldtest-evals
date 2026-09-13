export class AppError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;
  public readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function appErrorResponse(code: string, message: string, httpStatus: number, details: Record<string, unknown>) {
  return { error: { code, message, details } };
}
