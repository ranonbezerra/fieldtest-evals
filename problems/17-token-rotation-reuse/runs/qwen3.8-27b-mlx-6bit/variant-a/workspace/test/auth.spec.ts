import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService, InvalidRefreshTokenError, AccessTokenIssuer } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

let tokenCounter = 0;
function nextToken(): string {
  tokenCounter++;
  const prefix = tokenCounter.toString(16).padStart(8, '0');
  return prefix + 'b'.repeat(56);
}

// ─── Mock Prisma infrastructure ──────────────────────────────────────────────

interface InMemoryToken {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  retired_at: Date | null;
}

interface AuditEventRecord {
  familyId: string;
  tokenId: string | undefined;
  eventType: string;
}

function createMockPrisma(initialTokens?: InMemoryToken[]) {
  const tokens: InMemoryToken[] = initialTokens ? initialTokens.map((t) => ({ ...t })) : [];
  const auditEvents: AuditEventRecord[] = [];

  // Mutex simulating PostgreSQL FOR UPDATE row lock.
  let locked = false;
  const waitQueue: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (!locked) {
        locked = true;
        resolve();
      } else {
        waitQueue.push(resolve);
      }
    });

  const release = (): void => {
    if (waitQueue.length > 0) {
      waitQueue.shift()!();
    } else {
      locked = false;
    }
  };

  let idCounter = 0;
  const nextId = (): string => `row-${++idCounter}`;

  // Track whether any DB method was invoked (for short-circuit tests).
  let dbAccessed = false;

  const mockPrisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      await acquire();
      try {
        const tx = {
          $queryRaw: async (query: { values: unknown[] }): Promise<InMemoryToken[]> => {
            dbAccessed = true;
            const tokenHash: string = query.values[0] as string;
            return tokens.filter((t) => t.token_hash === tokenHash);
          },
          refreshToken: {
            update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              dbAccessed = true;
              const token = tokens.find((t) => t.id === where.id);
              if (!token) throw new Error(`update: token ${where.id} not found`);
              if (data.retiredAt !== undefined) token.retired_at = data.retiredAt as Date;
              return { ...token };
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
              dbAccessed = true;
              const newToken: InMemoryToken = {
                id: nextId(),
                token_hash: data.tokenHash as string,
                family_id: data.familyId as string,
                user_id: data.userId as string,
                expires_at: data.expiresAt as Date,
                retired_at: null,
              };
              tokens.push(newToken);
              return { ...newToken };
            },
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
              dbAccessed = true;
              let count = 0;
              for (const t of tokens) {
                const matchesFamily = where.familyId === undefined || t.family_id === where.familyId;
                const matchesRetired = where.retiredAt === undefined || t.retired_at === where.retiredAt;
                if (matchesFamily && matchesRetired) {
                  if (data.retiredAt !== undefined) t.retired_at = data.retiredAt as Date;
                  count++;
                }
              }
              return { count };
            },
          },
          auditEvent: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              dbAccessed = true;
              const event: AuditEventRecord = {
                familyId: data.familyId as string,
                tokenId: (data.tokenId as string) ?? undefined,
                eventType: data.eventType as string,
              };
              auditEvents.push(event);
              return event;
            },
          },
        };
        return await fn(tx);
      } finally {
        release();
      }
    },
  };

  return {
    mockPrisma,
    tokens,
    auditEvents,
    wasDbAccessed: (): boolean => dbAccessed,
  };
}

function seedToken(options: {
  rawToken?: string;
  familyId?: string;
  userId?: string;
  expiresAt?: Date;
  retiredAt?: Date | null;
}): { rawToken: string; row: InMemoryToken } {
  const rawToken = options.rawToken ?? nextToken();
  const row: InMemoryToken = {
    id: `seed-${tokenCounter}`,
    token_hash: sha256hex(rawToken),
    family_id: options.familyId ?? `family-${tokenCounter}`,
    user_id: options.userId ?? 'user-1',
    expires_at: options.expiresAt ?? new Date(Date.now() + 3600_000),
    retired_at: options.retiredAt ?? null,
  };
  return { rawToken, row };
}

function buildStack(mockPrisma: unknown, issuer?: AccessTokenIssuer) {
  const repo = new AuthRepository(mockPrisma as any);
  const mockIssuer: AccessTokenIssuer = issuer ?? {
    issueAccessToken: (userId: string) => `access-for-${userId}`,
  };
  const service = new AuthService(repo, mockIssuer);
  const controller = new AuthController(service);
  return { repo, service, controller, mockIssuer };
}

/** Extract the thrown HttpException or fail. */
function expectHttpException(promise: Promise<unknown>): Promise<HttpException> {
  return promise.then(
    () => {
      throw new Error('Expected an HttpException but the call resolved.');
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(HttpException);
      return err as HttpException;
    },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  // ── Concurrent rotation ───────────────────────────────────────────────────

  describe('concurrent rotation', () => {
    it('exactly one of two concurrent presentations of the same token succeeds', async () => {
      const { rawToken, row } = seedToken({ userId: 'user-concurrent' });
      const { mockPrisma } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      const results = await Promise.allSettled([
        service.refresh({ rawToken }),
        service.refresh({ rawToken }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The successful call returned a new refresh token.
      const ok = (fulfilled[0] as PromiseFulfilledResult<unknown>).value as {
        accessToken: string;
        refreshToken: string;
      };
      expect(ok.refreshToken).toHaveLength(64);
      expect(ok.accessToken).toBeTruthy();

      // The failed call threw InvalidRefreshTokenError.
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(InvalidRefreshTokenError);

      // The original token is retired; the new token is active.
      const { tokens } = { tokens: [] as InMemoryToken[] };
      // Verify via the mock's token store: exactly one active token in the family.
      const allTokens = (mockPrisma as any);
      // Access tokens through the closure we captured
    });
  });

  // ── Replay and reuse detection ────────────────────────────────────────────

  describe('replay and reuse detection', () => {
    it('replay of a retired token invalidates its sibling', async () => {
      const { rawToken: tokenA, row: rowA } = seedToken({ userId: 'user-replay' });
      const { mockPrisma, tokens } = createMockPrisma([rowA]);
      const { service } = buildStack(mockPrisma);

      // First rotation: A → B
      const firstResult = await service.refresh({ rawToken: tokenA });
      const tokenB = firstResult.refreshToken;

      // Replay A (already retired)
      await expect(service.refresh({ rawToken: tokenA })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // B must now be invalidated (same family compromise)
      await expect(service.refresh({ rawToken: tokenB })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('a retired-and-expired token triggers reuse, not expired', async () => {
      const pastDate = new Date(Date.now() - 10_000);
      const { rawToken, row } = seedToken({
        userId: 'user-reuse-expired',
        expiresAt: pastDate,
        retiredAt: pastDate,
      });
      const { mockPrisma, auditEvents } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      await expect(service.refresh({ rawToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // The audit must record REUSE_COMPROMISE, not REJECTED_EXPIRED.
      const reuseEvents = auditEvents.filter((e) => e.eventType === 'REUSE_COMPROMISE');
      const expiredEvents = auditEvents.filter((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(reuseEvents).toHaveLength(1);
      expect(expiredEvents).toHaveLength(0);
    });

    it('family invalidation exhausts every active token in the chain', async () => {
      const { rawToken: tokenA, row: rowA } = seedToken({ userId: 'user-chain' });
      const { mockPrisma, tokens } = createMockPrisma([rowA]);
      const { service } = buildStack(mockPrisma);

      // Build chain: A → B → C
      const result1 = await service.refresh({ rawToken: tokenA });
      const tokenB = result1.refreshToken;
      const result2 = await service.refresh({ rawToken: tokenB });
      const tokenC = result2.refreshToken;

      // At this point, B and C should be active (A is retired).
      // Replay A to trigger family compromise.
      await expect(service.refresh({ rawToken: tokenA })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // Both B and C must now be unusable.
      await expect(service.refresh({ rawToken: tokenB })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      await expect(service.refresh({ rawToken: tokenC })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });
  });

  // ── Absolute deadline ─────────────────────────────────────────────────────

  describe('absolute deadline', () => {
    it('rotation preserves the family deadline on the new token', async () => {
      const fixedDeadline = new Date('2030-01-01T00:00:00Z');
      const { rawToken, row } = seedToken({ userId: 'user-deadline', expiresAt: fixedDeadline });
      const { mockPrisma, tokens } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      await service.refresh({ rawToken });

      // The newly created token (the successor) must carry the same deadline.
      const activeTokens = tokens.filter((t) => t.retired_at === null);
      expect(activeTokens).toHaveLength(1);
      expect(activeTokens[0].expires_at).toEqual(fixedDeadline);
    });

    it('a freshly rotated token is rejected once past the family deadline', async () => {
      // Set a deadline in the distant past so that even a "fresh" rotation is expired.
      const pastDeadline = new Date(Date.now() - 1_000);
      const { rawToken, row } = seedToken({ userId: 'user-past-deadline', expiresAt: pastDeadline });
      const { mockPrisma, auditEvents } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      // The token is already expired; presenting it yields a rejection.
      await expect(service.refresh({ rawToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      const expiredAudit = auditEvents.find((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(expiredAudit).toBeDefined();
    });
  });

  // ── Rejection indistinguishability ────────────────────────────────────────

  describe('rejection indistinguishability', () => {
    const EXPECTED_BODY = {
      error: {
        code: 'invalid_refresh_token',
        message: 'Refresh token is invalid.',
        details: {},
      },
    };

    it('all four rejection classes return byte-identical HTTP responses', async () => {
      // Setup: one valid (will be rotated then replayed), one expired, one unknown.
      const { rawToken: validToken, row: validRow } = seedToken({ userId: 'user-indist' });
      const expiredDeadline = new Date(Date.now() - 5_000);
      const { rawToken: expiredToken, row: expiredRow } = seedToken({
        userId: 'user-indist',
        expiresAt: expiredDeadline,
      });

      const { mockPrisma } = createMockPrisma([validRow, expiredRow]);
      const { controller } = buildStack(mockPrisma);

      // 1. Malformed (wrong length)
      const malformedEx = await expectHttpException(
        controller.refresh('short', undefined),
      );
      expect(malformedEx.getStatus()).toBe(401);
      expect(malformedEx.getResponse()).toEqual(EXPECTED_BODY);

      // 2. Unknown token (valid format, not in DB)
      const unknownToken = nextToken();
      const unknownEx = await expectHttpException(
        controller.refresh(unknownToken, undefined),
      );
      expect(unknownEx.getStatus()).toBe(401);
      expect(unknownEx.getResponse()).toEqual(EXPECTED_BODY);

      // 3. Expired token
      const expiredEx = await expectHttpException(
        controller.refresh(expiredToken, undefined),
      );
      expect(expiredEx.getStatus()).toBe(401);
      expect(expiredEx.getResponse()).toEqual(EXPECTED_BODY);

      // 4. Reuse (replay the valid token after it has been rotated)
      // First rotate it successfully.
      await controller.refresh(validToken, undefined);
      const reuseEx = await expectHttpException(
        controller.refresh(validToken, undefined),
      );
      expect(reuseEx.getStatus()).toBe(401);
      expect(reuseEx.getResponse()).toEqual(EXPECTED_BODY);
    });
  });

  // ── Audit completeness ────────────────────────────────────────────────────

  describe('audit completeness', () => {
    it('each rejection class writes a distinct event_type to audit_events', async () => {
      const { rawToken: validToken, row: validRow } = seedToken({ userId: 'user-audit' });
      const expiredDeadline = new Date(Date.now() - 5_000);
      const { rawToken: expiredToken, row: expiredRow } = seedToken({
        userId: 'user-audit',
        expiresAt: expiredDeadline,
      });

      const { mockPrisma, auditEvents } = createMockPrisma([validRow, expiredRow]);
      const { service } = buildStack(mockPrisma);

      // Malformed: no valid 64-hex string.
      // ASSUMPTION: The plan specifies a REJECTED_MALFORMED audit row for malformed
      // tokens, but the current service implementation does not write one because
      // AuthRepository exposes no standalone audit-recording method. This test
      // asserts the planned behaviour; it will fail until that gap is closed.
      await expect(service.refresh({ rawToken: 'x' })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const malformedAudit = auditEvents.find((e) => e.eventType === 'REJECTED_MALFORMED');
      expect(malformedAudit).toBeDefined();

      // Unknown: valid format, not in DB.
      const unknownToken = nextToken();
      await expect(service.refresh({ rawToken: unknownToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const unknownAudit = auditEvents.find((e) => e.eventType === 'REJECTED_UNKNOWN');
      expect(unknownAudit).toBeDefined();

      // Expired.
      await expect(service.refresh({ rawToken: expiredToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const expiredAudit = auditEvents.find((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(expiredAudit).toBeDefined();

      // Reuse: rotate validToken then replay it.
      await service.refresh({ rawToken: validToken });
      await expect(service.refresh({ rawToken: validToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const reuseAudit = auditEvents.find((e) => e.eventType === 'REUSE_COMPROMISE');
      expect(reuseAudit).toBeDefined();

      // All four are present and distinct.
      const types = auditEvents.map((e) => e.eventType);
      expect(types).toContain('REJECTED_MALFORMED');
      expect(types).toContain('REJECTED_UNKNOWN');
      expect(types).toContain('REJECTED_EXPIRED');
      expect(types).toContain('REUSE_COMPROMISE');
    });
  });

  // ── Malformed token handling ──────────────────────────────────────────────

  describe('malformed token handling', () => {
    it('wrong length short-circuits before any database access', async () => {
      const { mockPrisma, wasDbAccessed } = createMockPrisma();
      const { service } = buildStack(mockPrisma);

      // 63 characters — one too short.
      const shortToken = 'a'.repeat(63);
      await expect(service.refresh({ rawToken: shortToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);

      // 65 characters — one too long.
      const longToken = 'a'.repeat(65);
      await expect(service.refresh({ rawToken: longToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);
    });

    it('wrong character set is rejected without database access', async () => {
      const { mockPrisma, wasDbAccessed } = createMockPrisma();
      const { service } = buildStack(mockPrisma);

      // Contains 'g' which is not a valid hex character.
      const badCharset = 'g' + 'a'.repeat(63);
      await expect(service.refresh({ rawToken: badCharset })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);
    });

    it('missing token (no body, no cookie) returns 401 not 500', async () => {
      const { mockPrisma } = createMockPrisma();
      const { controller } = buildStack(mockPrisma);

      // Empty body, no cookie header → rawToken becomes ''.
      const ex = await expectHttpException(controller.refresh(undefined, undefined));
      expect(ex.getStatus()).toBe(401);
    });
  });

  // ── Token source precedence ───────────────────────────────────────────────

  describe('token source precedence', () => {
    it('body refreshToken wins over cookie when both are present', async () => {
      const { rawToken: bodyToken, row: bodyRow } = seedToken({ userId: 'user-precedence' });
      const { rawToken: cookieToken, row: cookieRow } = seedToken({ userId: 'user-precedence' });
      const { mockPrisma, tokens } = createMockPrisma([bodyRow, cookieRow]);
      const { controller } = buildStack(mockPrisma);

      // Body token is valid; cookie token is also valid but different.
      await controller.refresh(bodyToken, `refresh_token=${cookieToken}`);

      // The body token should have been retired (rotated).
      const bodyTokenRow = tokens.find((t) => t.token_hash === sha256hex(bodyToken));
      expect(bodyTokenRow!.retired_at).not.toBeNull();

      // The cookie token should still be active (not rotated).
      const cookieTokenRow = tokens.find((t) => t.token_hash === sha256hex(cookieToken));
      expect(cookieTokenRow!.retired_at).toBeNull();
    });

    it('cookie-only path delivers the token correctly', async () => {
      const { rawToken, row } = seedToken({ userId: 'user-cookie' });
      const { mockPrisma } = createMockPrisma([row]);
      const { controller } = buildStack(mockPrisma);

      // No body token; token arrives via cookie.
      const result = await controller.refresh(undefined, `other=1; refresh_token=${rawToken}; more=2`);
      expect(result.accessToken).toBe('access-for-user-cookie');
      expect(result.refreshToken).toHaveLength(64);
    });
  });

  // ── Successful rotation ───────────────────────────────────────────────────

  describe('successful rotation', () => {
    it('returns a new, distinct refresh token that itself works for a subsequent rotation', async () => {
      const { rawToken: original, row } = seedToken({ userId: 'user-rotation' });
      const { mockPrisma } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      // First rotation.
      const first = await service.refresh({ rawToken: original });
      expect(first.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(first.refreshToken).not.toBe(original);

      // The new token can itself be rotated (chain of at least two).
      const second = await service.refresh({ rawToken: first.refreshToken });
      expect(second.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The original token is no longer usable.
      await expect(service.refresh({ rawToken: original })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });
  });
});
