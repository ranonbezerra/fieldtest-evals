# 05-auth.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/auth/auth.controller.ts` based on the plan.

From the plan (section 3):
```typescript
// src/auth/auth.controller.ts

export class AuthController {
  constructor(private readonly service: AuthService);

  /** POST /auth/refresh */
  @Post('refresh')
  refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult>;
}
```

From the plan (section 4, control flow):
1. Controller extracts raw token: body `refreshToken` if present, else parse `refresh_token` from `cookie` header. If neither, treat as empty string (→ malformed).
2. Controller calls `service.refresh({ rawToken })`.
8. Controller catches `InvalidRefreshTokenError`, returns **401** body:
   ```json
   { "error": { "code": "invalid_refresh_token", "message": "Refresh token is invalid.", "details": {} } }
   ```

Now, looking at the conventions:
- Controller validates input and calls the service. Zero business logic.
- The error envelope is: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }`
- Endpoints are kebab-case, plural. Wait, the endpoint is `/auth/refresh` — that's what the plan says. Let me re-read... The plan says `POST /auth/refresh`. The convention says "Endpoint: kebab-case, plural." But the plan explicitly says `POST /auth/refresh`. The plan governs, so I'll use `/auth/refresh`.

Wait, actually looking more carefully at the conventions: "Endpoint: `kebab-case`, plural." But the plan says `POST /auth/refresh`. The task says "PLAN.md above is your own specification and governs." So I follow the plan.

Actually, looking at this more carefully - the controller needs to:
1. Extract token from body `refreshToken` or cookie `refresh_token` (body wins)
2. Call service
3. Handle the error with the uniform 401 response

For NestJS, I need to think about how to handle the error. The plan says the controller catches `InvalidRefreshTokenError` and returns 401. I can use `@Catch` decorator or a try/catch in the controller, or an exception filter. But the plan says "Controller catches" — so I'll do a try/catch in the controller method, or I could use an exception filter. 

Actually, looking at the plan more carefully, it says "Controller catches `InvalidRefreshTokenError`, returns **401**". The simplest approach that keeps zero business logic in the controller is to use a try/catch or an exception filter. But an exception filter would be a separate file. Let me just use try/catch in the controller since the plan doesn't name a separate filter file.

Wait, but the convention says "controller validates input and calls the service. Zero business logic." Catching an error and formatting a response is not business logic — it's input/output handling. So try/catch in the controller is fine.

Let me also think about the cookie parsing. The cookie header looks like `key1=value1; key2=value2`. I need to parse out `refresh_token` from it. This is simple string parsing, not business logic.

Let me write the file:

```typescript
import { Controller, Post, Body, Headers, ConflictException } from '@nestjs/common';
import { AuthService, RefreshResult, InvalidRefreshTokenError } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult> {
    // Body `refreshToken` wins; cookie is the fallback. If neither, empty string → malformed.
    const rawToken = bodyToken ?? parseCookie(cookieHeader, 'refresh_token') ?? '';

    try {
      return await this.service.refresh({ rawToken });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        throw new UnauthorizedException(...); // need to return 401 with the envelope
      }
      throw err;
    }
  }
}
```

Hmm, but I need to return a specific 401 response with the error envelope. In NestJS, I can use `HttpException` or return a Response object. Let me think...

Actually, the cleanest way in NestJS to return a specific status and body is to use `@Res()` or throw an exception. Since the error envelope is `{ "error": { "code": "invalid_refresh_token", "message": "Refresh token is invalid.", "details": {} } }` with status 401, I can:

1. Use `@Res() res: Response` and manually set status + JSON
2. Throw a custom exception with the right format
3. Use `HttpException` with a custom payload

Option 1 is the most explicit and doesn't require a separate exception filter file. Let me use that.

Actually wait - looking at the conventions again: "Errors — one envelope" with the specific format. The controller should return this format. Using `@Res()` gives full control over the response.

Let me refine:

```typescript
import { Controller, Post, Body, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, RefreshResult, InvalidRefreshTokenError } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const rawToken = bodyToken ?? parseCookieValue(cookieHeader, 'refresh_token') ?? '';

    try {
      const result = await this.service.refresh({ rawToken });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        res.status(401).json({
          error: {
            code: 'invalid_refresh_token',
            message: 'Refresh token is invalid.',
            details: {},
          },
        });
      } else {
        throw err;
      }
    }
  }
}

function parseCookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}
```

Wait, but the plan says the controller signature returns `Promise<RefreshResult>`. If I use `@Res()`, the return type should be `void` or `Promise<void>` since I'm writing directly to the response. But the plan shows `Promise<RefreshResult>`. Hmm.

Actually, let me re-read the plan: "Controller catches `InvalidRefreshTokenError`, returns **401**". This could mean the controller method throws an exception that results in a 401 response. In NestJS, if I throw an `HttpException` with status 401 and the right body, NestJS will handle it.

Let me use `HttpException`:

```typescript
import { Controller, Post, Body, Headers, HttpException } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult> {
    const rawToken = bodyToken ?? parseCookieValue(cookieHeader, 'refresh_token') ?? '';

    try {
      return await this.service.refresh({ rawToken });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        throw new HttpException(
          { error: { code: 'invalid_refresh_token', message: 'Refresh token is invalid.', details: {} } },
          401,
        );
      }
      throw err;
    }
  }
}
```

This is cleaner and matches the plan's return type `Promise<RefreshResult>`. The `HttpException` with status 401 and the body will produce exactly the right response.

Now, about the `// ASSUMPTION` — do I need one? Let me check if everything is resolvable:
- `AuthService` — from plan, exported from `./auth.service.js` ✓
- `RefreshResult` — from plan, exported from `./auth.service.js` ✓
- `InvalidRefreshTokenError` — from plan, exported from `./auth.service.js` ✓
- The cookie parsing logic is straightforward
- The error format is specified in the plan

I don't think I need any ASSUMPTION comments. Everything is clearly defined.

Let me also check: the convention says "TS file: `kebab-case.role.ts`" — the file is `auth.controller.ts` ✓. "Class: `PascalCase`" — `AuthController` ✓.

One more thing: the plan says the endpoint is `POST /auth/refresh`. In NestJS, `@Controller('auth')` + `@Post('refresh')` gives `/auth/refresh`. ✓

Let me finalize the file. I'll keep it clean and complete.
```

## reply

```typescript
import { Controller, Post, Body, Headers, HttpException } from '@nestjs/common';
import { AuthService, RefreshResult, InvalidRefreshTokenError } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Accepts a refresh token either as the JSON body field `refreshToken` or
   * as the `refresh_token` cookie. When both are present, the body value wins;
   * the cookie is a fallback for browser clients that cannot set a header.
   */
  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<RefreshResult> {
    const rawToken = bodyToken ?? parseCookieValue(cookieHeader, 'refresh_token') ?? '';

    try {
      return await this.service.refresh({ rawToken });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        throw new HttpException(
          {
            error: {
              code: 'invalid_refresh_token',
              message: 'Refresh token is invalid.',
              details: {},
            },
          },
          401,
        );
      }
      throw err;
    }
  }
}

function parseCookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  const prefix = `${name}=`;
  for (const segment of header.split(';')) {
    const trimmed = segment.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return undefined;
}
```
