export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

// ASSUMPTION: the API base URL comes from the VITE_API_URL environment
// variable; an empty value means the API is served from the same origin.
const API_BASE: string = import.meta.env.VITE_API_URL ?? '';

// ASSUMPTION: non-2xx responses use the platform error envelope
// { "error": { "code", "message", "details" } }; the variant does not state
// the API's error contract.
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (authToken !== null) {
    headers.authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 204) {
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw toApiError(res.status, body);
  }
  return body as T;
}

function toApiError(status: number, body: unknown): ApiError {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
      const e = error as { code: string; message: string; details?: unknown };
      return new ApiError(status, e.code, e.message, (e.details ?? {}) as Record<string, unknown>);
    }
  }
  return new ApiError(status, 'api_error', `Request failed with status ${status}`);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unexpected error';
}
