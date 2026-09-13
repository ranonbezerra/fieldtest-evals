import { Injectable } from "@nestjs/common";
import { PayoutRepository } from "./payout.repository.js";
import { ProviderService } from "./provider.service.js";
import {
  CreatePayoutDto,
  PayoutStatus,
  MessageStatus,
  AppException,
  InsufficientFundsException,
  AccountNotFoundException,
  MAX_RETRY_ATTEMPTS,
} from "./payout.types.js";

@Injectable()
export class PayoutService {
  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  async createPayout(dto: CreatePayoutDto) {
    const account = await this.repository.findAccountById(dto.accountId);
    if (!account) {
      throw new AccountNotFoundException(dto.accountId);
    }

    const existing = await this.repository.findByCardIdempotencyKey(
      dto.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    const result = await this.repository.atomicReserveAndCreatePayout(dto);
    if (!result) {
      throw new InsufficientFundsException(
        dto.accountId,
        BigInt(account.settledBalance) - BigInt(account.reservedBalance),
        BigInt(dto.amount),
      );
    }

    const payout = await this.repository.findByCardIdempotencyKey(
      dto.idempotencyKey,
    );
    return payout;
  }

  async processPayout(payoutId: string) {
    const payout = await this.repository.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found`);
    }

    if (
      payout.status === PayoutStatus.COMPLETED ||
      payout.status === PayoutStatus.FAILED ||
      payout.status === PayoutStatus.NEEDS_REVIEW
    ) {
      return;
    }

    if (payout.status !== PayoutStatus.CREATED && payout.status !== PayoutStatus.PROCESSING) {
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, PayoutStatus.PROCESSING);

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < MAX_RETRY_ATTEMPTS) {
      try {
        const { txHash } = await this.provider.transfer({
          to: payout.destinationAddress,
          amount: payout.amount,
        });

        await this.repository.updatePayoutStatus(payoutId, PayoutStatus.SENT, {
          txHash,
        });

        const confirmed = await this.provider.confirm(txHash);
        if (confirmed) {
          await this.repository.settlePayout(payoutId, payout.accountId, payout.amount);
          return;
        } else {
          lastError = new Error("Provider did not confirm");
          attempts++;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;
      }

      if (attempts >= MAX_RETRY_ATTEMPTS) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }

    await this.repository.updatePayoutStatus(payoutId, PayoutStatus.NEEDS_REVIEW);
  }

  async processConfirmations() {
    const sentPayouts = await this.repository.findSentPayoutsForConfirmation();
    for (const payout of sentPayouts) {
      if (!payout.txHash) continue;

      try {
        const confirmed = await this.provider.confirm(payout.txHash);
        if (confirmed) {
          await this.repository.settlePayout(payout.id, payout.accountId, payout.amount);
        } else {
          await this.repository.updatePayoutStatus(payout.id, PayoutStatus.SENT, {
            confirmAttempts: (payout.confirmAttempts || 0) + 1,
          });
        }
      } catch {
        // Leave as SENT, retry on next cycle
      }
    }
  }
}
