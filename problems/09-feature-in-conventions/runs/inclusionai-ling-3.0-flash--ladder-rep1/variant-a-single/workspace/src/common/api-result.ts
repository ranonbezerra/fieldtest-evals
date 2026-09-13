import type { AppError, AppErrorCode } from './app-error.js';

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: { code: AppErrorCode; message: string; details: Record<string, unknown> };
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

export const ApiResult = {
  ok<T>(data: T): ApiOk<T> {
    return { ok: true, data };
  },
  err(e: AppError): ApiErr {
    return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
  },
};
