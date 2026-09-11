export function serializeResponse(transfer: {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: bigint;
  idempotencyKey: string;
  status: string;
}): Record<string, unknown> {
  return {
    id: transfer.id,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    amount: transfer.amount.toString(),
    idempotencyKey: transfer.idempotencyKey,
    status: transfer.status,
  };
}
