export interface Provider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
