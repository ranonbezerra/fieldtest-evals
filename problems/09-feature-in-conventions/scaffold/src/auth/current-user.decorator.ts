import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { AuthedRequest } from './auth.guard.js';
import type { CurrentUserPayload } from './types.js';

/**
 * `@CurrentUser()` — always used together with `AuthGuard`. It never reaches
 * into the database: a controller that needs the full row asks its service.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new AppError('unauthenticated', 'no current user');
    return req.user;
  },
);
