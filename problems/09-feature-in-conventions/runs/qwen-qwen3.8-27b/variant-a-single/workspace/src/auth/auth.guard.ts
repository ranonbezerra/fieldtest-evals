import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import type { CurrentUserPayload } from './types.js';

export interface AuthedRequest extends Request {
  user?: CurrentUserPayload;
}

/**
 * Resolves the caller and attaches it to the request. The scaffold's stub reads
 * a signed header; swapping it for real tokens does not change anything below.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const id = req.header('x-user-id');
    const email = req.header('x-user-email');
    if (!id || !email) {
      throw new AppError('unauthenticated', 'missing credentials');
    }
    req.user = { id, email };
    return true;
  }
}
