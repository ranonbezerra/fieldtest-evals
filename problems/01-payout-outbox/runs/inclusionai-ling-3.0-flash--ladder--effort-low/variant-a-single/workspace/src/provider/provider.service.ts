import { Injectable } from '@nestjs/common';

/**
 * Wraps the external blockchain provider SDK.
 * provider.transfer({to, amount}) -> {txHash}
 * ASSUMPTION: The provider also exposes confirmTransfer(txHash: string) => Promise<boolean>
 * to check whether a previously sent transfer has landed on-chain.
 */
@Injectable()
export class ProviderService {
  async transfer(to: string, amount: bigint): Promise<{ txHash: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { provider } = require('external-provider-sdk'); // eslint-disable-line
    return provider.transfer({ to, amount });
  }

  async confirmTransfer(txHash: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { provider } = require('external-provider-sdk'); // eslint-disable-line
    return provider.confirm(txHash);
  }
}
