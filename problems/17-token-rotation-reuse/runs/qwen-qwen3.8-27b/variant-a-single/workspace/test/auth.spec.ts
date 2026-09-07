import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: AuthService is instantiated with (repository, prisma) where prisma
//   exposes `$transaction(fn)`. The rotation entry-point is `rotate(refreshToken: string)`.
// ASSUMPTION: On success the method resolves to { accessToken: string, refreshToken: string }.
// ASSUMPTION: On any rejection path (expired, retired/replay, unknown, malformed) the
//   method rejects. The controller maps all rejections to the same error envelope.
// ASSUMPTION: The repository exposes methods that accept an optional `tx` parameter
//   for use inside a Prisma interactive transaction.

type RotationResult = { accessToken: string; refreshToken: string };

interface TokenRecord {
  id: string;
  value: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  absoluteExpiry: Date;
  retired: boolean;
}

function makeToken(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    id: 'tok-1',
    value: 'rt-valid',
    userId: 'user-1',
    familyId: 'fam-1',
    expiresAt: new Date(Date.now() + 3_600_000),
    absoluteExpiry: new Date(Date.now() + 86_400_000),
    retired: false,
    ...overrides,
  };
}

function makeRepository() {
  return {
    findToken: vi.fn(),
    retireToken: vi.fn(),
    issueToken: vi.fn(),
    invalidateFamily: vi.fn(),
    recordAudit: vi.fn(),
  };
}

function makePrisma() {
  return {
    $transaction: vi.fn(<T>(fn: (tx: Record<string, unknown>) => Promise<T>) =>
      fn({}),
    ),
  };
}

describe('AuthService — refresh-token rotation', () => {
  let service: AuthService;
  let repo: ReturnType<typeof makeRepository>;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    repo = makeRepository();
    prisma = makePrisma();
    service = new AuthService(repo as any, prisma as any);
  });

  // ── 1. Concurrent presentation of one token ──────────────────────────

  describe('concurrent presentation of the same token', () => {
    it('exactly one call rotates; the other is rejected', async () => {
      const token = makeToken();
      const sibling = makeToken({ id: 'tok-2', value: 'rt-sibling' });

      // Simulate: first caller sees the token as valid, second sees it retired.
      let call = 0;
      repo.findToken.mockImplementation(async (_tx: unknown, _v: string) => {
        call++;
        return call === 1 ? token : { ...token, retired: true };
      });
      repo.retireToken.mockResolvedValue(undefined);
      repo.issueToken.mockResolvedValue(sibling);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      const results = await Promise.allSettled([
        service.rotate('rt-valid') as Promise<RotationResult>,
        service.rotate('rt-valid') as Promise<RotationResult>,
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const ok = (fulfilled[0] as PromiseFulfilledResult<RotationResult>).value;
      expect(ok.accessToken).toBeTypeOf('string');
      expect(ok.refreshToken).toBeTypeOf('string');
      expect(ok.refreshToken).not.toBe('rt-valid');
    });
  });

  // ── 2. Replay of a retired token invalidates the sibling ─────────────

  describe('replay of a retired token', () => {
    it('invalidates the whole family and records an audit event', async () => {
      const retired = makeToken({ retired: true });

      repo.findToken.mockResolvedValue(retired);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      await expect(service.rotate('rt-valid')).rejects.toThrow();

      expect(repo.invalidateFamily).toHaveBeenCalledWith(expect.anything(), 'fam-1');
      expect(repo.recordAudit).toHaveBeenCalled();
    });

    it('the sibling token is no longer usable after the replay', async () => {
      const retired = makeToken({ id: 'tok-1', retired: true });
      const sibling = makeToken({ id: 'tok-2', value: 'rt-sibling' });

      // First: the retired token is presented → triggers family invalidation.
      // Second: the sibling is presented → now also retired (family invalidated).
      let findCall = 0;
      repo.findToken.mockImplementation(async () => {
        findCall++;
        return findCall === 1 ? retired : { ...sibling, retired: true };
      });
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      await expect(service.rotate('rt-valid')).rejects.toThrow();
      await expect(service.rotate('rt-sibling')).rejects.toThrow();

      expect(repo.invalidateFamily).toHaveBeenCalled();
    });
  });

  // ── 3. Rotation respects the absolute session deadline ────────────────

  describe('absolute session deadline', () => {
    it('rejects rotation when the absolute expiry has passed even if the token itself is unexpired', async () => {
      const token = makeToken({
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiry: new Date(Date.now() - 1_000),
      });

      repo.findToken.mockResolvedValue(token);

      await expect(service.rotate('rt-valid')).rejects.toThrow();

      expect(repo.issueToken).not.toHaveBeenCalled();
      expect(repo.retireToken).not.toHaveBeenCalled();
    });
  });

  // ── 4. All rejections are indistinguishable to the caller ─────────────

  describe('rejection indistinguishability', () => {
    const scenarios: Array<[label: string, token: TokenRecord | null]> = [
      ['expired', makeToken({ expiresAt: new Date(Date.now() - 1_000) })],
      ['retired', makeToken({ retired: true })],
      ['unknown', null],
    ];

    it.each(scenarios)('rejects a %s token with the same shape', async (_label, token) => {
      repo.findToken.mockResolvedValue(token);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      const err = await service.rotate('rt-valid').catch((e) => e);

      expect(err).toBeInstanceOf(Error);
    });

    it('all rejection errors carry the same message', async () => {
      const messages: string[] = [];

      for (const [, token] of scenarios) {
        repo.findToken.mockResolvedValue(token);
        repo.invalidateFamily.mockResolvedValue(undefined);
        repo.recordAudit.mockResolvedValue(undefined);

        const err = (await service.rotate('rt-valid').catch((e) => e)) as Error;
        messages.push(err.message);
      }

      expect(messages[0]).toBe(messages[1]);
      expect(messages[1]).toBe(messages[2]);
    });
  });
});
