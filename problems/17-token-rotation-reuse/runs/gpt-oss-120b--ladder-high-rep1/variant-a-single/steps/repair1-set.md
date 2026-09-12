# repair1-set

## reasoning

```
We need to fix import paths likely case-sensitive. Files are in src/refresh/... but imports use './refresh.service' etc which exist. Perhaps tsconfig path base? The issue likely missing index files? Actually file extensions .ts need to be referenced with .ts? In ESM, need file extensions in imports. So need to add .js extension? Since "type":"module", need .js extension in imports. So change imports to include .js. Also express types need @types/express installed; but compile error can't find module 'express' - need to install types or import from 'express' works if types present. Probably need to add import type? Actually need to add dev dependency; but we can't. Better to use built-in types: import { Request, Response } from 'express'; still error if types missing. Could add a stub file? Simpler: change to import from 'express' to import from '@nestjs/common' for Request, Response? Nest provides Request, Response types from @nestjs/common. Use import { Request, Response } from 'express' but need types. Add @types/express not possible. We'll create a local declaration file? Not allowed. Probably better to use any.

Change method signature to use any for req,res to avoid import. Remove import of express.

Also invalid-refresh-token.exception file likely missing. Need to create that file. Not present. So need to add file src/refresh/invalid-refresh-token.exception.ts with class extending HttpException returning proper error envelope. Implement.

Also need prisma.service file missing. Need to create src/prisma.service.ts with PrismaClient wrapper.

Also test imports need path adjustments .js? test uses relative imports to src files, that's okay.

Add fail function import from vitest? In vitest, fail is global? Actually fail is from vitest. Need import { fail } from 'vitest'.

Also implicit any parameters need typing. Add explicit any.

Let's implement needed files and adjust imports.

Files to change: src/refresh/refresh.controller.ts imports, src/refresh/refresh.module.ts imports, src/refresh/refresh.service.ts imports, src/refresh/refresh.repository.ts imports, test/refresh.spec.ts fix typings and import fail.

Create src/refresh/invalid-refresh-token.exception.ts.

Create src/prisma.service.ts.

Update imports to include .js? In ESM, need .js extensions for local modules. So import './refresh.service.js' etc. We'll add .js.

Proceed.
```

## reply

### src/refresh/refresh.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RefreshService } from './refresh.service.js';
import { Request, Response } from '@nestjs/common';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception.js';

@Controller()
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  /**
   * POST /auth/refresh
   * Accepts a refresh token either in the JSON body (`refreshToken`) or in the
   * `refresh_token` cookie. **If both are present, the body token takes precedence.**
   */
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const tokenFromBody: string | undefined = body?.refreshToken;
    const tokenFromCookie: string | undefined = req.cookies?.refresh_token;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    if (!refreshToken) {
      // malformed request – treat as generic rejection
      throw new InvalidRefreshTokenException();
    }

    const result = await this.refreshService.refresh(refreshToken);

    // Return the new refresh token as an HttpOnly cookie (optional but common)
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    // Also include it in the JSON body for API consumers that prefer it
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
```

### src/refresh/refresh.module.ts
```ts
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller.js';
import { RefreshService } from './refresh.service.js';
import { RefreshRepository } from './refresh.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [],
  controllers: [RefreshController],
  providers: [RefreshService, RefreshRepository, PrismaService],
  exports: [RefreshService],
})
export class RefreshModule {}
```

### src/refresh/refresh.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { RefreshToken, AuditLog } from '@prisma/client';

@Injectable()
export class RefreshRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { token } });
  }

  /**
   * Atomically retires a token if it is still active and not expired.
   * Returns true if the row was updated (i.e., the token was retired now).
   */
  async retireIfActive(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id,
        retiredAt: null,
        invalidatedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        retiredAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        familyId,
        invalidatedAt: null,
      },
      data: {
        invalidatedAt: new Date(),
      },
    });
  }

  async createRefreshToken(data: {
    token: string;
    userId: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({
      data: {
        token: data.token,
        userId: data.userId,
        familyId: data.familyId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async logAudit(
    eventType: string,
    details: Record<string, unknown>,
    tokenId?: string,
    userId?: string,
  ): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        eventType,
        details,
        tokenId,
        userId,
      },
    });
  }
}
```

### src/refresh/refresh.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RefreshRepository } from './refresh.repository.js';
import { InvalidRefreshTokenException } from './invalid-refresh-token.exception.js';
import { issueAccessToken } from '../auth/token.utils.js';
import * as crypto from 'crypto';
import { RefreshToken } from '@prisma/client';

@Injectable()
export class RefreshService {
  constructor(private readonly refreshRepo: RefreshRepository) {}

  async refresh(refreshTokenValue: string): Promise<{ accessToken: string; refreshToken: string }> {
    const token = await this.refreshRepo.findByToken(refreshTokenValue);
    if (!token) {
      await this.refreshRepo.logAudit('unknown_token', { presentedToken: refreshTokenValue });
      throw new InvalidRefreshTokenException();
    }

    // 1️⃣ Reuse detection (invalidated family) – must be checked before anything else
    if (token.invalidatedAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_invalidated',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 2️⃣ Token already retired (reuse of a rotated token)
    if (token.retiredAt) {
      await this.refreshRepo.logAudit('reuse', {
        reason: 'already_retired',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 3️⃣ Expiry check – after reuse checks to satisfy “reuse before expiry”
    const now = new Date();
    if (token.expiresAt <= now) {
      await this.refreshRepo.logAudit('expired_token', { tokenId: token.id, userId: token.userId });
      throw new InvalidRefreshTokenException();
    }

    // 4️⃣ Atomic retirement – ensures exactly one concurrent rotation succeeds
    const retired = await this.refreshRepo.retireIfActive(token.id);
    if (!retired) {
      // Token was retired concurrently → treat as reuse
      await this.refreshRepo.logAudit('reuse', {
        reason: 'concurrent_retirement',
        tokenId: token.id,
        userId: token.userId,
      });
      await this.refreshRepo.invalidateFamily(token.familyId);
      throw new InvalidRefreshTokenException();
    }

    // 5️⃣ Successful rotation – create a fresh token with the same absolute deadline
    const newTokenValue = crypto.randomBytes(32).toString('hex');
    await this.refreshRepo.createRefreshToken({
      token: newTokenValue,
      userId: token.userId,
      familyId: token.familyId,
      expiresAt: token.expiresAt, // absolute deadline unchanged
    });

    const accessToken = issueAccessToken(token.userId);
    return { accessToken, refreshToken: newTokenValue };
  }
}
```

### src/refresh/invalid-refresh-token.exception.ts
```ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidRefreshTokenException extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token',
          details: {},
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
```

### src/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### test/refresh.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { RefreshModule } from '../src/refresh/refresh.module.js';
import { RefreshService } from '../src/refresh/refresh.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { InvalidRefreshTokenException } from '../src/refresh/invalid-refresh-token.exception.js';
import { PrismaClient, RefreshToken } from '@prisma/client';
import * as crypto from 'crypto';
import { fail } from 'vitest';

describe('RefreshService', () => {
  let module: TestingModule;
  let refreshService: RefreshService;
  let prisma: PrismaService;

  const USER_ID = 'test-user';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [RefreshModule],
    }).compile();

    refreshService = module.get<RefreshService>(RefreshService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createRootToken(opts?: { expiresInMs?: number }): Promise<RefreshToken> {
    const tokenValue = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (opts?.expiresInMs ?? 60 * 60 * 1000));
    return prisma.refreshToken.create({
      data: {
        token: tokenValue,
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });
  }

  it('concurrent presentation of same token rotates exactly once', async () => {
    const root = await createRootToken();
    const tokenValue = root.token;

    // Fire two refreshes concurrently
    const attempt1 = refreshService.refresh(tokenValue).catch((e) => e);
    const attempt2 = refreshService.refresh(tokenValue).catch((e) => e);
    const results = await Promise.all([attempt1, attempt2]);

    const successes = results.filter((r) => !(r instanceof InvalidRefreshTokenException));
    const failures = results.filter((r) => r instanceof InvalidRefreshTokenException);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const successResult = successes[0] as { accessToken: string; refreshToken: string };

    // All tokens belonging to the family must now be invalidated
    const familyTokens = await prisma.refreshToken.findMany({
      where: { familyId: root.familyId },
    });
    for (const t of familyTokens) {
      expect(t.invalidatedAt).not.toBeNull();
    }

    // An audit entry for reuse must exist
    const reuseLog = await prisma.auditLog.findFirst({ where: { eventType: 'reuse' } });
    expect(reuseLog).toBeDefined();
  });

  it('replay after rotation invalidates sibling token', async () => {
    const root = await createRootToken();
    const rootValue = root.token;

    // First rotation (root -> A)
    const first = await refreshService.refresh(rootValue);
    const tokenA = first.refreshToken;

    // Second rotation (A -> B)
    const second = await refreshService.refresh(tokenA);
    const tokenB = second.refreshToken;

    // Replay of token A – should cause family invalidation
    await expect(refreshService.refresh(tokenA)).rejects.toBeInstanceOf(InvalidRefreshTokenException);

    // Token B must now be invalidated
    const tokenBRecord = await prisma.refreshToken.findUnique({ where: { token: tokenB } });
    expect(tokenBRecord).toBeDefined();
    expect(tokenBRecord?.invalidatedAt).not.toBeNull();
  });

  it('rotation does not extend absolute deadline', async () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now
    const root = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt,
      },
    });

    const result = await refreshService.refresh(root.token);
    const newToken = await prisma.refreshToken.findUnique({ where: { token: result.refreshToken } });
    expect(newToken).toBeDefined();
    expect(newToken?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('all rejection responses are identical', async () => {
    // Helper to capture the error payload
    const captureError = async (fn: () => Promise<any>) => {
      try {
        await fn();
        fail('expected exception');
      } catch (e) {
        const err = e as any;
        return err.getResponse().error;
      }
    };

    // Unknown token
    const errUnknown = await captureError(() => refreshService.refresh('nonexistent'));
    // Expired token
    const expired = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() - 1000), // already past
      },
    });
    const errExpired = await captureError(() => refreshService.refresh(expired.token));
    // Retired token
    const retired = await prisma.refreshToken.create({
      data: {
        token: crypto.randomBytes(32).toString('hex'),
        userId: USER_ID,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await prisma.refreshToken.update({
      where: { id: retired.id },
      data: { retiredAt: new Date() },
    });
    const errRetired = await captureError(() => refreshService.refresh(retired.token));
    // Malformed token (empty string)
    const errMalformed = await captureError(() => refreshService.refresh(''));

    const expected = {
      code: 'invalid_refresh_token',
      message: 'Invalid refresh token',
      details: {},
    };

    expect(errUnknown).toEqual(expected);
    expect(errExpired).toEqual(expected);
    expect(errRetired).toEqual(expected);
    expect(errMalformed).toEqual(expected);
  });
});
```
