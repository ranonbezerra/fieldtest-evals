export interface ProviderInterface {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
