describe('payout service', () => {

  it('concurrent creation against one account never overdrafts', async () => {
    const service = new PayoutService(repo, fakeProvider(async () => ({ txHash: '0xunused' })));
    const accountId = await createAccount(3_000n);

    const attempts = Array.from({ length: 5 }, (_, i) =>
      service.createPayout({
        accountId,
        amount: 1_000n,
        destinationAddress: `0xdest${i}`,
        idempotencyKey: `key-${randomUUID()}`,
      }),
    );
    const settled = await Promise.allSettled(attempts);

    const created = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const rejected = settled.filter((r) => r.status === 'rejected');

    expect(created).toHaveLength(3);
    expect(new Set(created.map((p) => p.id)).size).toBe(3);
    for (const payout of created) {
      expect(payout.status).toBe('created');
      expect(payout.amount).toBe(1_000n);
    }
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(PayoutError);
      expect((r.reason as PayoutError).code).toBe('insufficient_funds');
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.reservedAmount).toBe(3_000n); // exactly the created payouts, no more
    expect(account.settledBalance).toBe(3_000n); // settled only moves on provider confirmation
  });
