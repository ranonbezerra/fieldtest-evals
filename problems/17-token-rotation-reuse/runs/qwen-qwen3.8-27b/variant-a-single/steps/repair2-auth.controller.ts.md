# repair2-auth.controller.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/auth/auth.controller.ts`:

1. `src/auth/auth.controller.ts(2,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.`

This is the only error in `auth.controller.ts`. The file imports `AuthService` from `./auth.service`, but the module can't be found. Looking at the reference, `auth.service.ts` exists at `src/auth/auth.service.ts`. So why can't it be found?

Wait, let me re-read the reference. The file `src/auth/auth.service.ts` exists but it's incomplete - it only has the class skeleton with no `rotate` method. But the file exists, so the import should work...

Actually, looking more carefully at the error: `Cannot find module './auth.service' or its corresponding type declarations.` This could mean the file doesn't exist on disk, or it exists but has a syntax error that prevents it from being recognized as a module.

But the task says "Change nothing the messages do not name." The only message naming `auth.controller.ts` is:
- `src/auth/auth.controller.ts(2,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.`

The other errors are in `auth.service.ts` and `test/auth.spec.ts`.

So I need to fix the controller so that line 2 (column 29) no longer produces that error. The issue is that the import from `./auth.service` fails. 

Wait, but the task says "Change nothing the messages do not name." The messages do name `auth.controller.ts` at line 2, column 29. That's the import line. I need to make this file compile.

But I can't change `auth.service.ts` because the task says to only fix what the messages require of `auth.controller.ts`. The messages for `auth.service.ts` are separate.

Hmm, but the task says "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file." So I'm only rewriting the controller file. The error in the controller is that it can't find `./auth.service`. 

But `auth.service.ts` exists in the reference material. The issue might be that the file is malformed (it's incomplete - missing the `rotate` method). But that wouldn't cause a "Cannot find module" error - it would cause a different error.

Actually, "Cannot find module" typically means the file literally doesn't exist on disk. But the reference shows it does exist. This is confusing.

Wait - let me re-read the task. The task says "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file." The only message about this file is the TS2307 at line 2, col 29.

The column 29 on line 2 points to the module path in the import. Looking at the reference controller:
```
2	import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
```

Wait no, line 2 col 29 would be... let me count. Actually the reference shows the file starts with a comment on line 1. Let me look again:

```
1	// src/auth/auth.controller.ts
2	import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
```

Hmm, column 29 on line 2... `import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';`

Column 29 would be around `Controller`. That doesn't make sense for a "Cannot find module" error pointing to `@nestjs/common`.

Wait, maybe the file on disk is different from what's shown in the reference. The reference is "read-only reference" material. Let me look at the actual error more carefully:

`src/auth/auth.controller.ts(2,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.`

So line 2, column 29 is where `./auth.service` appears. That means the actual file on disk must have a different line 1 than what's shown. Perhaps line 1 is empty or the comment is on a different line, and line 2 is the import of `./auth.service`.

Actually, looking at the reference more carefully, the output shows:
```
1	// src/auth/auth.controller.ts
2	import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
3	import type { Request, Response } from 'express';
4	import { AuthService } from './auth.service';
```

So line 4 is the import of `./auth.service`. But the error says line 2, col 29. This means the file on disk is different from what the reference shows. The reference is just "read-only reference material" - it shows what was read but the actual file might be different.

OK, I think I'm overcomplicating this. The task is clear: rewrite `src/auth/auth.controller.ts` to be complete and fix the TS2307 error. The file needs to import `AuthService` from `./auth.service` and that module needs to exist.

Since `auth.service.ts` exists (as shown in the reference), the "Cannot find module" error might be because:
1. The file on disk is actually missing (despite the reference showing it)
2. The file has a syntax error that makes TypeScript not recognize it as a module

But I'm told to only fix `auth.controller.ts`. I can't create or modify `auth.service.ts`.

Actually wait - re-reading the instructions: "Change nothing the messages do not name." The messages name `auth.controller.ts`, `auth.service.ts`, and `test/auth.spec.ts`. But the task says "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file."

So I'm ONLY rewriting `auth.controller.ts`. The other files will be fixed separately or are out of scope.

The error `TS2307: Cannot find module './auth.service'` - if `auth.service.ts` exists on disk but has issues, the controller can't do anything about it except... not import it? But the plan requires the controller to call the service.

Hmm, but actually - if the file `auth.service.ts` exists but is syntactically broken (which it appears to be - it's just a skeleton), TypeScript might still resolve the module but report errors in that file. The TS2307 "Cannot find module" specifically means the file doesn't exist or can't be resolved.

I think the most likely explanation is that the file simply doesn't exist yet on disk (the reference shows what was planned/read but the file wasn't actually created, or was created empty). 

But my task is only to write `auth.controller.ts`. I'll write it correctly importing from `./auth.service`. If `auth.service.ts` doesn't exist, that's a problem for a different fix. But the task says to fix "what these messages require of this file" - the message requires that the module can be found. Since I can only control this file, I'll write it with the correct import path.

Actually, I think the right interpretation is: the file `auth.service.ts` DOES exist (as shown in the reference - it's a skeleton). The "Cannot find module" might be a red herring caused by the file being empty or having a BOM issue or something. But since I'm told to fix the controller, I'll just write it correctly.

Let me write the complete `auth.controller.ts` based on the PLAN.md:

1. `POST /auth/refresh` endpoint
2. Accepts `refreshToken` from JSON body OR `refresh_token` from cookie
3. JSON body wins when both are present
4. Returns new access token and new refresh token
5. All rejections return the same indistinguishable envelope
6. Controller validates input and calls service, zero business logic

From the plan:
- Controller: Parse input (body/cookie), validate presence, call service, shape response
- The error envelope is: `{ "error": { "code": "invalid_token", "message": "Invalid or expired refresh token", "details": {} } }`
- HTTP status for rejections: The plan says "returns the same HTTP status code" - looking at the reference controller, it uses `HttpStatus.UNAUTHORIZED` (401). That makes sense for an invalid token.

For the success case, the reference uses `@HttpCode(HttpStatus.OK)` which is 200.

Now, what does the service's `rotate` method look like? From the test errors:
- `test/auth.spec.ts(85,17): error TS2339: Property 'rotate' does not exist on type 'AuthService'.`
- The test calls `service.rotate(something)` - and from line 63: `Expected 1 arguments, but got 2` suggests the constructor takes 1 arg but the test passes 2.

From the service skeleton:
```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly issueAccessToken: (userId: string) => string,
  ) {}
}
```

So the constructor takes 2 args: `repo` and `issueAccessToken`. The test at line 63 passes 2 args but the error says "Expected 1 arguments, but got 2" - this means the current file on disk has a different constructor (maybe just `repo`). But again, I'm not fixing the service.

The `rotate` method needs to accept a token string and return either a success result or throw an exception. Based on the plan and the indistinguishability requirement, the service should throw an `UnauthorizedException` for all rejections.

Let me think about what the controller needs:

```typescript
import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieToken = req.cookies?.refresh_token as string | undefined;
    const refreshToken = bodyToken ?? cookieToken;

    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.authService.rotate(refreshToken);
      res.status(HttpStatus.OK).json(result);
    } catch {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
    }
  }
}
```

Wait, but I need to think about what `rotate` returns. The plan says:
"7. Return `{ accessToken, refreshToken: newTokenId }`."

So the service returns `{ accessToken: string, refreshToken: string }`.

Now, regarding the `req.cookies` - this requires the `cookie-parser` middleware. I'll assume it's set up (the plan mentions cookie support).

Let me also consider: should I use `@Res()` or let NestJS handle the response? Using `@Res()` gives full control which is needed for the indistinguishability requirement (same status code for all error types).

Actually, I could also not use `@Res()` and instead throw exceptions. But the plan says all rejections return the same envelope. If I throw `UnauthorizedException` with the right message, NestJS would format it. But to ensure the exact envelope shape, using `@Res()` is safer.

Let me also think about whether I need `cookie-parser`. The `req.cookies` property is added by the `cookie-parser` middleware. I'll assume it's configured in the app. If not, I could parse `req.headers.cookie` manually. But the plan says to support cookies, so I'll use `req.cookies` and add an assumption if needed.

Actually, to be safe and not assume `cookie-parser` is installed, I could parse the cookie header manually. But that's more complex and the reference code uses `req.cookies?.refresh_token`. Let me stick with that pattern.

Let me finalize the controller. The key requirements from the plan:
1. POST /auth/refresh
2. Accept token from body (`refreshToken`) or cookie (`refresh_token`)
3. Body wins over cookie
4. Return new access + refresh token on success
5. All rejections: same HTTP status, same envelope
6. Controller: zero business logic, just parse input, validate presence, call service, shape response

One thing to note: the "malformed" case. If the token is missing entirely, that's also a rejection that must be indistinguishable. So missing token → same error envelope.

Let me write the final version:
```

## reply

```typescript
// src/auth/auth.controller.ts
import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Precedence: JSON body wins over cookie.
    const cookieToken = req.cookies?.refresh_token as string | undefined;
    const refreshToken = bodyToken ?? cookieToken;

    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.authService.rotate(refreshToken);
      res.status(HttpStatus.OK).json(result);
    } catch {
      res.status(HttpStatus.UNAUTHORIZED).json({
        error: {
          code: 'invalid_token',
          message: 'Invalid or expired refresh token',
          details: {},
        },
      });
    }
  }
}
```
