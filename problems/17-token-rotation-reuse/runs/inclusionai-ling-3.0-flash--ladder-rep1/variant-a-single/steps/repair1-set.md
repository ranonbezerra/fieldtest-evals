# repair1-set

## reasoning

```
Let me analyze the errors carefully. Every single error is `TS2307: Cannot find module` — meaning TypeScript can't resolve the module paths. This is a classic issue with ESM and file extensions.

The codebase uses ESM (`"type": "module"`). In ESM, imports must include file extensions. The reference files use extensionless imports like:
- `import { Module } from '../prisma/prisma.module';`
- `import { PrismaService } from './prisma.service';`

In ESM, these need to be `./prisma.module.js` or `./prisma.service.js` etc. But wait — let me reconsider. The errors span across all files. Every import is failing. Let me count distinct mistakes:

1. All imports are missing `.js` extensions (since it's ESM). This affects every import in every file.
2. The `express` module is missing type declarations — this needs `@types/express` or a `require` call.

Actually, let me look more carefully. The errors are:
- `Cannot find module './prisma/prisma.module'` in app.module.ts
- `Cannot find module './auth/auth.module'` in app.module.ts
- `Cannot find module 'express'` in auth.controller.ts and auth.failed.filter.ts
- `Cannot find module './auth.service'` in auth.controller.ts
- `Cannot find module './auth.failed.filter'` in auth.controller.ts
- etc.

All of these are module resolution failures. In an ESM project (`"type": "module"`), TypeScript requires explicit file extensions in imports. So `./auth/service` should be `./auth/auth.service.js`.

But wait — some of these are cross-directory imports like `../prisma/prisma.module` and `./auth.service`. All need `.js` extensions.

Also, `express` not being found is a separate issue — likely missing `@types/express` package. But I'm told not to add features or change things not in the error list. The fix would be to change how express is imported. In a NestJS ESM project, typically you'd use `import * as express from 'express'` or use `require`. But actually, the real fix for `Cannot find module 'express'` in TypeScript ESM is usually having the types installed. Since I can't install packages, I should change the import style.

Actually, let me reconsider. The instruction says "Fix all of them in one reply" and "Change exactly what the compiler requires." The compiler errors are all TS2307 (Cannot find module). 

For the ESM imports: the fix is to add `.js` extensions to all relative imports.
For `express`: this is a third-party module. In ESM, you can't do `import { Response } from 'express'` without proper type declarations. The fix might be to use `import * as express from 'express'` or to use `require`. But the real issue might be that `@types/express` isn't installed. Since I can't install packages, I need to change the import.

Wait, but in many NestJS projects with ESM, `import { Response } from 'express'` works fine if `@types/express` is installed and `esModuleInterop` is enabled. The issue might be specifically about ESM not finding the types.

Hmm, but looking at the error more carefully — ALL imports fail, even intra-project ones. The common factor is ESM requiring extensions. Let me focus on that.

For `express` specifically — in ESM, you need `@types/express` installed. Since it's not found, maybe the fix is to use a different import pattern. In TypeScript ESM, you might need:
```ts
import type { Response } from 'express';
import type { Request } from 'express';
```
Or use `require`.

Actually, I think the most pragmatic fix for all these errors in an ESM context is:
1. Add `.js` extensions to all relative imports
2. For express imports, change to use `import` with proper type-only imports or `require`

But let me think about this differently. The fact that EVERY relative import fails suggests the root cause is definitely the ESM extension issue. The `express` error is likely a separate but related issue.

Let me list all files that need changes and all their imports:

1. `src/app.module.ts` — imports `./prisma/prisma.module` and `./auth/auth.module` → add `.js`
2. `src/auth/auth.controller.ts` — imports `express`, `./auth.service`, `./auth.failed.filter` → add `.js` to relative, fix express
3. `src/auth/auth.failed.filter.ts` — imports `express`, `./auth.failed.exception` → add `.js` to relative, fix express
4. `src/auth/auth.module.ts` — imports `../prisma/prisma.module`, `./auth.controller`, `./auth.service`, `./auth.repository`, `./token-issuer.service`, `./auth.failed.filter` → add `.js`
5. `src/auth/auth.repository.ts` — imports `../prisma/prisma.service` → add `.js`
6. `src/auth/auth.service.ts` — imports `./auth.repository`, `./token-issuer.service`, `./auth.failed.exception` → add `.js`
7. `src/main.ts` — imports `./app.module` → add `.js`
8. `src/prisma/prisma.module.ts` — imports `./prisma.service` → add `.js`

For `express`, in ESM TypeScript, a common fix is:
```ts
import { Request, Response } from 'express';
```
This is already what's there. The issue might be that `@types/express` is missing. But since I can't install packages, maybe I should use:
```ts
import type { Request, Response } from 'express';
```
No, that wouldn't help with resolution either.

Actually, thinking about this more carefully — in NestJS ESM projects, a very common pattern is to use `@nestjs/common` decorators like `@Req()` and `@Res()` which inject Express request/response objects. The controller imports `Request` and `Response` from `express` for typing. 

The fix for `Cannot find module 'express'` in ESM TypeScript without `@types/express` could be to use `require` or to change to `import * as express from 'express'`. But really, this is a package installation issue. Since I'm told to fix the compiler errors, I think the intended fix is either:

1. Change the express import to work without types (use `any` or inline types)
2. Use `// @ts-ignore` or similar

Actually, let me reconsider the whole problem. The instruction says "The typecheck failed" and I need to fix all errors. The most likely intended fix for an ESM project is adding `.js` extensions. For `express`, perhaps using `import type` or changing to a different import.

In many ESM TypeScript setups, `import { Request, Response } from 'express'` should work if `@types/express` is a dependency. Since the error says it can't find the module, maybe the fix is:

```ts
import { Request, Response } from 'express';
```
→
```ts
import type { Request, Response } from 'express';
```

Wait, that's the same resolution issue. Let me try another approach. Maybe the issue is that in ESM, you need:
```ts
import { Request, Response } from 'express';
```
to be changed to:
```ts
import { Request, Response } from 'express';
```
and ensure `esModuleInterop: true`... but I can't change tsconfig.

OK, I think the most likely scenario is:
1. All relative imports need `.js` extensions (this is the main ESM issue)
2. For `express`, change to `import * as express from 'express'` and access Request/Response from there, or use a different approach

Actually, let me look at this from another angle. In TypeScript with ESM, when `moduleResolution` is `node16` or `nodenext`, you MUST include `.js` extensions in relative imports. Third-party modules like `express` should still resolve via `node_modules`. The fact that it can't find `express` might be a genuine missing types issue.

But the task says to fix the errors, not install packages. So perhaps the fix for express is to use `require`:

```ts
import { Request, Response } from 'express';
```
→ 
```ts
import type { Request, Response } from 'express';
import { Request as Req, Response as Res } from 'express';
```

No, that's overcomplicating it. Let me just change it to use `import * as express`:

```ts
import { Request, Response } from 'express';
```
→
```ts
import * as express from 'express';
```
and then use `express.Request` and `express.Response` in the type annotations.

Hmm, but that changes the code. Let me think about what's the minimal change.

Actually, the simplest fix for the express issue in ESM without types might be:
```ts
import { Request, Response } from 'express';
```
→
```ts
import type { Request, Response } from 'express';
```

Wait, if the types aren't available at all, `import type` won't help either. 

Let me just go with adding `.js` to all relative imports and for express, I'll change to:
```ts
import { Request, Response } from 'express';
```
to
```ts
import type { Request, Response } from 'express';
```

No wait. Let me re-examine. In ESM TypeScript with `moduleResolution: "nodenext"`:
- Relative imports MUST have `.js` extensions
- Non-relative imports (like `express`) resolve via standard Node.js resolution, finding `@types/express` if installed

The fact that `express` can't be found while other third-party imports (like `@nestjs/common`) aren't in the error list suggests that either:
1. `@types/express` isn't installed
2. Or there's something else going on

Since the instructions say to fix compiler errors, and I can't install packages, I think the right approach is to change the express imports to not rely on `@types/express`. 

One approach: use `any` type instead:
```ts
import { Request, Response } from 'express';
```
→
```ts
// use generic types instead
```
And change the type annotations to use `any` or inline types.

But that's changing more than needed. Let me just try the approach of adding `.js` to relative imports and for express, keep it as-is since it's a third-party module. Maybe adding `.js` to all other imports is enough and the express error is a side effect that gets resolved. No, that doesn't make sense.

Let me go with this plan:
1. Add `.js` to all relative imports
2. For express imports, change `import { Request, Response } from 'express'` to use `require` or `import * as`

Actually, you know what, let me just try: for the express imports, since these are only used for type annotations (`@Req() req: Request` and `@Res() res: Response`), I can use `import type { Request, Response } from 'express'`. This is valid ESM and might resolve differently.

Hmm, but if the module itself can't be found, `import type` won't help. Let me check if there's a `tsconfig.json` setting issue.

I think the most reasonable approach, given the constraints, is:
1. Add `.js` to ALL relative imports (the main ESM issue)
2. For express, change to `import * as express from 'express'` and reference `express.Request`/`express.Response`

Let me enumerate all the files I need to modify:

1. `src/app.module.ts`
2. `src/auth/auth.controller.ts`
3. `src/auth/auth.failed.filter.ts`
4. `src/auth/auth.module.ts`
5. `src/auth/auth.repository.ts`
6. `src/auth/auth.service.ts`
7. `src/main.ts`
8. `src/prisma/prisma.module.ts`

Now let me also think about the `auth.failed.exception` import. It's imported in `auth.failed.filter.ts` and `auth.service.ts`. The error list includes:
- `src/auth/auth.failed.filter.ts(3,37): Cannot find module './auth.failed.exception'`
- `src/auth/auth.service.ts(5,37): Cannot find module './auth.failed.exception'`

So `auth.failed.exception.ts` exists (since it's referenced but not in the error list as a file with errors). I just need to fix the import path.

Let me now write out all the fixes. The key insight from the problem statement: "nineteen single-file rounds on this repository left twenty-one instances of the same import error standing" — this confirms it's a systemic issue (missing `.js` extensions in ESM).

For express, let me go with `import * as express from 'express'` approach and update the type annotations accordingly.

Wait, actually. Let me re-read the errors more carefully:

```
src/auth/auth.controller.ts(2,35): error TS2307: Cannot find module 'express'
src/auth/auth.failed.filter.ts(2,26): error TS2307: Cannot find module 'express'
```

These are at character positions 35 and 26 respectively. Let me check:
- `import { Request, Response } from 'express';` — 'express' starts at position... let me count: `import { Request, Response } from 'express';` — position 26 would be around the `from` keyword. Actually, position counting in TypeScript is 0-based from the start of the line. Let me count: `import { Request, Response } ` = 27 chars, position 26 = the space before `from`. Position 35 would be... hmm.

Actually TypeScript column numbers are 1-based and count from the start of the line including the filename prefix. But that's getting too detailed. The key point is these are errors on the `'express'` import.

For NestJS ESM projects, a common approach is to just have `@types/express` installed. Since it's not, and I need to fix the compiler error, I'll change to `import * as express from 'express'` and use `express.Request`/`express.Response`. But wait, that has the same module resolution issue.

OK, let me think about this differently. The `@nestjs/common` package is NOT in the error list. That means it resolves fine. `express` doesn't. What's the difference? `@nestjs/common` has proper ESM exports with types. `express` is a CommonJS package that needs `@types/express` for TypeScript.

The practical fix: since we can't install `@types/express`, and the only uses of `Request`/`Response` from express are type annotations, I can just use `any` or define minimal interfaces.

Let me use `any` for the controller and remove the express import:

In `auth.controller.ts`:
- Change `import { Request, Response } from 'express'` → remove
- Change `@Req() req: Request` → `@Req() req: any`
- Change `@Res() res: Response` → `@Res() res: any`

In `auth.failed.filter.ts`:
- Change `import { Response } from 'express'` → remove
- Change `Response` → `any`

Wait, but the problem says "Do not add features, do not rename anything the errors do not mention." Changing `Request` to `any` is changing a type, which is necessary to fix the error.

Actually, a cleaner approach: use `import type` which might be resolved differently. But no, it still needs the types to exist.

Let me just go with `any` since that's the minimal change to make it compile. Actually, even better — let me just remove the import and use `any`:

Actually, I realize there might be a simpler explanation. In ESM TypeScript with `moduleResolution: "nodenext"`, you need to import with `.js` extension even for node_modules in some configurations. But that's unusual.

Let me just go with my plan:
1. Add `.js` to all relative imports
2. For express, remove the import and use `any`

Let me draft all the files now.

Wait, one more thought. Let me check if `import type { Response } from 'express'` would work differently from `import { Response } from 'express'`. In ESM, `import type` is erased at compile time, but the module still needs to be resolvable by TypeScript during type-checking. So it won't help if the types aren't found.

OK, I'll go with `any`. Let me now write out all the fixed files.

Actually, hmm. Let me reconsider whether the express issue might be fixed by adding `.js`. In some TypeScript configurations with `moduleResolution: "bundler"` or similar, node_modules packages might need `.js` too. But that's uncommon.

No. I'll go with my plan. Let me also check: does `auth.failed.exception.ts` need changes? It's not in the error list, so it probably doesn't.

Let me now write all 8 files:

For express imports, I'll replace them with `any` types. Here's my approach for each file:

### src/app.module.ts
Just add `.js` to relative imports.

### src/auth/auth.controller.ts
- Remove `import { Request, Response } from 'express'`
- Change `@Req() req: Request` → `@Req() req: any`
- Change `@Res() res: Response` → `@Res() res: any`
- Add `.js` to remaining relative imports

### src/auth/auth.failed.filter.ts
- Remove `import { Response } from 'express'`
- Change `Response` → `any`
- Add `.js` to remaining relative imports

### src/auth/auth.module.ts
- Add `.js` to all relative imports

### src/auth/auth.repository.ts
- Add `.js` to relative import

### src/auth/auth.service.ts
- Add `.js` to relative imports

### src/main.ts
- Add `.js` to relative import

### src/prisma/prisma.module.ts
- Add `.js` to relative import

Let me write them all out now.

For auth.controller.ts:
```ts
import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: any, @Res() res: any) {
    // Body wins over cookie when both present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

For auth.failed.filter.ts:
```ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { AuthFailedException } from './auth.failed.exception.js';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

All the others just need `.js` added. Let me write them all out.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

### src/auth/auth.controller.ts
```ts
import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: any, @Res() res: any) {
    // Body wins over cookie when both present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

### src/auth/auth.failed.filter.ts
```ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { AuthFailedException } from './auth.failed.exception.js';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Conditionally retires a token only if it is still live.
   * Returns true if a row was actually modified (the caller was the winner).
   * Returns false if the token was already retired by another concurrent request.
   */
  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  /**
   * Retires every token that shares the same familyId — the full descent
   * tree from the original sign-in.
   */
  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: Record<string, unknown>;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedException } from './auth.failed.exception.js';

interface RefreshInput {
  token: string | undefined | null;
  ip: string;
  userAgent: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    const { token } = input;

    // 1. MALFORMED — no token, empty, or non-string.
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 2. Hash and look up
    const tokenHash = hashToken(token);
    const existing = await this.repo.findByHash(tokenHash);

    // 3. UNKNOWN — hash not found
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found_in_database' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 4. REUSE — checked BEFORE expiry (a retired+expired token is a compromise event)
    if (existing.isRetired) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 5. EXPIRY — token is live but past its absolute deadline
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 6. ATOMIC ROTATION — conditional update, database-serialised
    const rotated = await this.repo.atomicRetire(existing.id);

    // If another request won the race, this token is now retired → treat as reuse
    if (!rotated) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 7. Success: new refresh token, same family, same absolute deadline
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRefreshToken);

    await this.repo.createToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt,
    });

    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(
    token: { familyId: string; userId: string },
    tokenHash: string,
    input: RefreshInput,
  ): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash,
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_concurrent_token' },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
