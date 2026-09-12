/**
 * Port for the blockchain provider SDK. The SDK is assumed to expose
 * `provider.transfer({to, amount}) -> {txHash}` and may throw, time out, or
 * succeed slowly. A `TransferDefinitiveError` from the adapter marks failures
 * the provider stated explicitly (rejection, invalid recipient); any other
 * error is treated as an unknown outcome and retried.
 */
export interface TransferProvider {
  transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

export const TRANSFER_PROVIDER = Symbol('TRANSFER_PROVIDER');
