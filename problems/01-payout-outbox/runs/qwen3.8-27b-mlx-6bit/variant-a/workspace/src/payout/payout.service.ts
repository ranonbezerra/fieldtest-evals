async processMessages(): Promise<number> {
  let processed = 0;
  for (;;) {
    const msg = await this.repo.claimNextPendingMessage();
    if (!msg) break;
    const claimed = await this.repo.claimMessage(msg.id);
    if (!claimed) continue;
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}

private async processOneMessage(msg: Message): Promise<void> {
  // msg is already claimed (processing) by processMessages
  const payout = await this.repo.getPayout(msg.payoutId);
  if (!payout) {
    // orphaned message; mark done to avoid reprocessing? or dead?
    // Plan doesn't specify. Mark done.
    await this.repo.setMessageStatus(msg.id, 'done');
    return;
  }
  // set payout to processing
  await this.repo.updatePayoutStatus(payout.id, 'processing');
  // call provider outside tx
  try {
    const { txHash } = await this.provider.transfer(payout.destinationAddress, payout.amount);
    // success: in one tx
    await this.prisma.$transaction(async (tx) => {
      await this.repo.releaseReserved(tx, payout.accountId, payout.amount);
      await this.repo.settleOut(tx, payout.accountId, payout.amount);
      await this.repo.updatePayoutStatus(payout.id, 'sent', txHash); // wait, updatePayoutStatus doesn't take tx
      ...
    });
  } catch (e) {
    // failure handling
  }
}
