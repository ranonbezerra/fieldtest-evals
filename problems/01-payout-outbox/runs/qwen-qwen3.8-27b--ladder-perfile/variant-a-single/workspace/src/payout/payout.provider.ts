export interface TestProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
