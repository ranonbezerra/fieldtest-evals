export type ErrorCode =
  | 'resource_not_found'
  | 'conflict'
  | 'validation_error'
  | 'unauthorized'
  | 'unknown_tenant'
  | 'tenant_mismatch'
  | 'tenant_context_missing';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}
