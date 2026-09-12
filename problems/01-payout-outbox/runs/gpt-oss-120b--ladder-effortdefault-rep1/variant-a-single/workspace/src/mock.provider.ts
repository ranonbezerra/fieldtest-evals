import { Injectable } from '@nestjs/common';
import { Provider } from './provider.interface';

@Injectable()
export class MockProvider implements Provider {
  async transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    // Simple deterministic mock – in production this would call the real SDK
    return { txHash: `mock-tx-${Date.now()}` };
  }
}
