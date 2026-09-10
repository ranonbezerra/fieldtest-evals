export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error: { code, message, details } };
}
