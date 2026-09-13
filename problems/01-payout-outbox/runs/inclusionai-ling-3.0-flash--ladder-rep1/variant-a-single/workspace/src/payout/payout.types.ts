export enum PayoutStatus {
  CREATED = "CREATED",
  PROCESSING = "PROCESSING",
  SENT = "SENT",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  NEEDS_REVIEW = "NEEDS_REVIEW",
}

export enum MessageStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export interface CreatePayoutDto {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ProviderTransferResult {
  txHash: string;
}

export interface Provider {
  transfer(args: { to: string; amount: bigint }): Promise<ProviderTransferResult>;
  confirm(txHash: string): Promise<boolean>;
}

export class AppException extends Error {
  constructor(
    public code: string,
    public message: string,
    public details: Record<string, unknown> = {},
    public statusCode: number = 400,
  ) {
    super(message);
  }
}

export class InsufficientFundsException extends AppException {
  constructor(accountId: string, available: bigint, requested: bigint) {
    super(
      "insufficient_funds",
      `Account ${accountId} has insufficient available funds`,
      {
        accountId,
        available: available.toString(),
        requested: requested.toString(),
      },
      409,
    );
  }
}

export class AccountNotFoundException extends AppException {
  constructor(accountId: string) {
    super(
      "account_not_found",
      `Account ${accountId} not found`,
      { accountId },
      404,
    );
  }
}

export const MAX_RETRY_ATTEMPTS = 3;
export const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 5000;
export const MESSAGE_STUCK_TIMEOUT_MS = 60_000;
