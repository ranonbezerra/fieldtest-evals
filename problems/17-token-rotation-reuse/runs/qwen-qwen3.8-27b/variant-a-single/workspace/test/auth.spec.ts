import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service';

// ASSUMPTION: The AuthService constructor in the current workspace accepts 1 argument
// (the repository). The issueAccessToken function is expected to be available via a
// separate injection mechanism (e.g. a module-level provider) not visible in the stub.

// ASSUMPTION: The `rotate` method is specified by PLAN.md §3 but is not yet present on
// the compiled AuthService type. Tests express the contract via a local interface and
// a type assertion so the test file compiles against the current stub.

// ASSUMPTION: Repository method names are inferred from the PLAN.md algorithm. The
// repository stub is an empty class, so names follow the plan's intent.

// ─── Types ────────────────────────────────────────────────────────────────────────

interface RotateResult {
  accessToken: string;
  refreshToken: string;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

interface TokenRow {
  id: string;
  familyId: string;
  sessionId: string;
  createdAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

interface RepoContract {
  findTokenById(id: string): Promise<TokenRow | null>;
  findSessionById(id: string): Promise<SessionRow | null>;
  retireTokenIfActive(id: string): Promise<number>;
  createToken(data: { familyId: string; sessionId: string }): Promise<{ id: string }>;
  revokeFamily(familyId: string): Promise<void>;
  createAuditRecord(data: {
    familyId: string;
    tokenId: string;
    event: string;
    details: Record<string, unknown>;
  }): Promise<void>;
}

interface AuthServiceContract {
  rotate(token: string): Promise<RotateResult>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function createMockRepo(): RepoContract {
  return {
    findTokenById: vi.fn().mockResolvedValue(null),
    findSessionById: vi.fn().mockResolvedValue(null),
    retireTokenIfActive: vi.fn().mockResolvedValue(0),
    createToken: vi.fn().mockResolvedValue({ id: 'token-new' }),
    revokeFamily: vi.fn().mockResolvedValue(undefined),
    createAuditRecord: vi.fn().mockResolvedValue(undefined),
  };
}

function extractEnvelope(e: unknown): ErrorEnvelope {
  if (e !== null && typeof e === 'object' && 'response' in e) {
    return (e as { response: ErrorEnvelope }).response;
  }
  if (e !== null && typeof e === 'object' && 'error' in e) {
    return e as ErrorEnvelope;
  }
  throw new Error(`Unexpected rejection shape: ${String(e)}`);
}

async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e: unknown) {
    return e;
  }
  throw new Error('Expected promise to reject but it resolved');
}

// ─── Constants ────────────────────────────────────────────────────────────────────

const userId = 'user-1';
const familyId = 'family-1';
const sessionId = 'session-1';

// ─── Tests ────────────────────────────────────────────────────────────────────────

describe('AuthService — refresh-token rotation (Variant A)', () => {
  let repo: RepoContract;
  let service: AuthServiceContract;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = createMockRepo();
    // ASSUMPTION: 1-arg constructor per compiler (see top of file)
    const raw = new AuthService(repo as never);
    service = raw as unknown as AuthServiceContract;
  });

  // ── 1. Concurrent presentation of one token ──────────────────────────────────

  describe('concurrent presentation of one token', () => {
    it('exactly one of two concurrent rotate calls succeeds; the other is rejected', async () => {
      const tokenValue = 'token-A';
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      const tokenRow: TokenRow = {
        id: tokenValue,
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };
      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: now,
        expiresAt: futureExpiry,
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);
      // First CAS wins (1 row affected); second CAS loses (0 rows affected)
      repo.retireTokenIfActive.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      repo.createToken.mockResolvedValue({ id: 'token-B' });

      const results = await Promise.allSettled([
        service.rotate(tokenValue),
        service.rotate(tokenValue),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<RotateResult> => r.status === 'fulfilled',
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Winner returns fresh tokens
      expect(fulfilled[0].value.accessToken).toBeTypeOf('string');
      expect(fulfilled[0].value.refreshToken).toBe('token-B');

      // Loser gets the standard indistinguishable envelope
      const envelope = extractEnvelope(rejected[0].reason);
      expect(envelope.error.code).toBe('invalid_token');
      expect(envelope.error.details).toEqual({});
    });
  });

  // ── 2. Replay invalidates sibling token ──────────────────────────────────────

  describe('replay invalidates sibling token', () => {
    it('presenting an already-retired token revokes every token in the family', async () => {
      const now = new Date();

      const retiredRow: TokenRow = {
        id: 'token-A',
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: now,
        revokedAt: null,
      };

      repo.findTokenById.mockResolvedValue(retiredRow);
      repo.revokeFamily.mockResolvedValue(undefined);
      repo.createAuditRecord.mockResolvedValue(undefined);

      await expect(service.rotate('token-A')).rejects.toThrow();

      // Family-wide revocation was triggered
      expect(repo.revokeFamily).toHaveBeenCalledWith(familyId);

      // Audit recorded as reuse_detected
      expect(repo.createAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId,
          event: 'reuse_detected',
        }),
      );
    });
  });

  // ── 3. Rotation against absolute deadline ────────────────────────────────────

  describe('rotation against absolute deadline', () => {
    it('rejects rotation when the session has passed its absolute expiry', async () => {
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1_000);

      const tokenRow: TokenRow = {
        id: 'token-A',
        familyId,
        sessionId,
        createdAt: pastExpiry,
        retiredAt: null,
        revokedAt: null,
      };
      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry, // already in the past
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);
      repo.createAuditRecord.mockResolvedValue(undefined);

      await expect(service.rotate('token-A')).rejects.toThrow();

      // Audit says 'expired'
      expect(repo.createAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'expired' }),
      );

      // No new token was minted
      expect(repo.createToken).not.toHaveBeenCalled();
    });
  });

  // ── 4. Rejection responses compared to each other ────────────────────────────

  describe('rejection responses are indistinguishable', () => {
    it('unknown, expired, and retired (reuse) all produce the same envelope', async () => {
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1_000);
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      const activeSession: SessionRow = {
        id: sessionId,
        userId,
        createdAt: now,
        expiresAt: futureExpiry,
      };
      const expiredSession: SessionRow = {
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry,
      };

      const activeToken: TokenRow = {
        id: 'tok',
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };

      const envelopes: ErrorEnvelope[] = [];

      // 1 — Unknown token (not found in DB)
      repo.findTokenById.mockResolvedValueOnce(null);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('ghost-token'));
        envelopes.push(extractEnvelope(reason));
      }

      // 2 — Expired session
      repo.findTokenById.mockResolvedValueOnce(activeToken);
      repo.findSessionById.mockResolvedValueOnce(expiredSession);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('tok'));
        envelopes.push(extractEnvelope(reason));
      }

      // 3 — Retired token (reuse / compromise)
      const retiredToken: TokenRow = { ...activeToken, id: 'tok-retired', retiredAt: now };
      repo.findTokenById.mockResolvedValueOnce(retiredToken);
      repo.revokeFamily.mockResolvedValueOnce(undefined);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('tok-retired'));
        envelopes.push(extractEnvelope(reason));
      }

      // All three must be byte-identical in their observable fields
      for (let i = 1; i < envelopes.length; i++) {
        expect(envelopes[i].error.code).toBe(envelopes[0].error.code);
        expect(envelopes[i].error.message).toBe(envelopes[0].error.message);
        expect(envelopes[i].error.details).toEqual(envelopes[0].error.details);
      }

      // And they must use the single contract code
      expect(envelopes[0].error.code).toBe('invalid_token');
      expect(envelopes[0].error.details).toEqual({});
    });
  });
});
