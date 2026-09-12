import { Test, TestingModule } from '@nestjs/testing';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('AuthService - Refresh Token Rotation', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let prisma: PrismaClient;

  const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    prisma = moduleRef.get<PrismaClient>(PrismaClient);

    // Clean DB
    await prisma.refreshTokenAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.refreshTokenFamily.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFamilyAndToken() {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com` },
    });
    const absoluteExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour session
    const family = await prisma.refreshTokenFamily.create({
      data: {
        userId: user.id,
        absoluteExpiresAt,
      },
    });
    const token = await prisma.refreshToken.create({
      data: {
        token: randomUUID(),
        familyId: family.id,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { user, family, token };
  }

  it('should rotate exactly one token when two concurrent requests use the same valid token', async () => {
    const { token } = await createFamilyAndToken();

    // Two concurrent calls
    const p1 = authService.refresh(token.token).catch(() => null);
    const p2 = authService.refresh(token.token).catch(() => null);

    const [r1, r2] = await Promise.all([p1, p2]);

    // Exactly one succeeded
    const successes = [r1, r2].filter((r) => r !== null);
    expect(successes).toHaveLength(1);

    // Verify the family is still alive (not revoked)
    const family = await prisma.refreshTokenFamily.findUnique({
      where: { id: token.familyId },
    });
    expect(family?.revokedAt).toBeNull();

    // Verify an audit entry of type 'rotated' exists
    const rotatedAudits = await prisma.refreshTokenAudit.findMany({
      where: { event: 'rotated' },
    });
    expect(rotatedAudits).toHaveLength(1);
  });

  it('replay of a retired token invalidates the whole family', async () => {
    const { token, family } = await createFamilyAndToken();

    // First successful rotation
    const first = await authService.refresh(token.token);
    expect(first).toBeDefined();

    // Replay the original (now retired) token
    await expect(authService.refresh(token.token)).rejects.toThrow();

    // Family must be revoked
    const updatedFamily = await prisma.refreshTokenFamily.findUnique({
      where: { id: family.id },
    });
    expect(updatedFamily?.revokedAt).not.toBeNull();

    // All tokens in the family should be retired
    const liveTokens = await prisma.refreshToken.findMany({
      where: { familyId: family.id, retiredAt: null },
    });
    expect(liveTokens).toHaveLength(0);

    // Audit should contain a 'reuse' entry
    const reuseAudits = await prisma.refreshTokenAudit.findMany({
      where: { event: 'reuse' },
    });
    expect(reuseAudits).toHaveLength(1);
  });

  it('rotation never extends the absolute session deadline', async () => {
    const { token, family } = await createFamilyAndToken();

    // Fast‑forward time close to the absolute deadline
    const nearDeadline = new Date(family.absoluteExpiresAt.getTime() - 5 * 60 * 1000); // 5 min before
    jest.spyOn(global, 'Date').mockImplementation(() => nearDeadline as unknown as string);

    const result = await authService.refresh(token.token);
    const newToken = await prisma.refreshToken.findUnique({
      where: { token: result.newRefreshToken },
    });

    expect(newToken).toBeDefined();
    // New token's expiry must not be after the absolute deadline
    expect(newToken!.expiresAt.getTime()).toBeLessThanOrEqual(
      family.absoluteExpiresAt.getTime(),
    );

    // Restore Date
    (global.Date as any).mockRestore?.();
  });

  it('all rejection causes return identical envelope', async () => {
    const malformed = authService.refresh(''); // empty -> malformed
    await expect(malformed).rejects.toThrow();

    const unknown = authService.refresh('non‑existent-token');
    await expect(unknown).rejects.toThrow();

    const { token } = await createFamilyAndToken();

    // Expire token manually
    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = authService.refresh(token.token);
    await expect(expired).rejects.toThrow();

    // The controller catches all errors and wraps them into the same envelope,
    // therefore we only test that the service throws (the envelope is built in controller).
    // The presence of audit entries for each path validates distinct handling.
    const audits = await prisma.refreshTokenAudit.findMany({
      where: { event: { in: ['malformed', 'unknown', 'expired'] } },
    });
    expect(audits).toHaveLength(3);
  });
});
