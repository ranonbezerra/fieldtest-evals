import type { ErrorCode } from './error-codes.js';

export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  static resourceNotFound(id: string): AppException {
    return new ConcreteAppException(404, 'resource_not_found', `Resource ${id} not found`);
  }

  static conflict(field: string): AppException {
    return new ConcreteAppException(409, 'conflict', `Conflict on field: ${field}`);
  }

  static validationError(message: string): AppException {
    return new ConcreteAppException(400, 'validation_error', message);
  }

  static unauthorized(): AppException {
    return new ConcreteAppException(401, 'unauthorized', 'Unauthorized');
  }

  static unknownTenant(host: string): AppException {
    return new ConcreteAppException(403, 'unknown_tenant', `Unknown tenant for host: ${host}`);
  }

  static tenantMismatch(expected: string, actual: string): AppException {
    return new ConcreteAppException(403, 'tenant_mismatch', `Tenant mismatch: expected ${expected}, got ${actual}`);
  }

  static tenantContextMissing(): AppException {
    return new ConcreteAppException(500, 'tenant_context_missing', 'Tenant context is missing');
  }
}

class ConcreteAppException extends AppException {}
