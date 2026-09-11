import { Prisma } from '@prisma/client';
import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { TenantContextMissingError } from '../prisma/tenant-context';

export interface ErrorDecision {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * The single place that decides how any error maps onto the error envelope.
 * Used by the global exception filter and by the tenant middleware, which
 * must answer (401/403/404) before any request-scoped context exists.
 */
export function decideError(err: unknown): ErrorDecision {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof TenantContextMissingError) {
    return {
      status: 500,
      code: 'no_tenant_context',
      message: 'a query was attempted with no tenant in context; it was refused rather than run unscoped',
      details: {},
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      // Record not found. For tenant-scoped models this deliberately covers
      // both "does not exist" and "belongs to another tenant" — same body,
      // so an id from another operator is indistinguishable from a ghost id.
      return { status: 404, code: 'resource_not_found', message: 'resource not found', details: {} };
    }
    if (err.code === 'P2002') {
      return {
        status: 409,
        code: 'conflict',
        message: 'a record with the same unique value already exists',
        details: { prismaCode: err.code },
      };
    }
    if (err.code === 'P2003') {
      return {
        status: 409,
        code: 'conflict',
        message: 'the operation violates a referential constraint',
        details: { prismaCode: err.code },
      };
    }
    return {
      status: 409,
      code: 'database_error',
      message: 'the database rejected the operation',
      details: { prismaCode: err.code },
    };
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: 'bad_request', message: 'the query failed Prisma validation', details: {} };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code =
      status === 404 ? 'not_found' : status === 405 ? 'method_not_allowed' : status === 400 ? 'bad_request' : 'http_error';
    return { status, code, message: err.message, details: {} };
  }
  return { status: 500, code: 'internal_error', message: 'unexpected internal error', details: {} };
}
