import { Injectable } from '@nestjs/common';
import { TransferDefinitiveError } from './payout.service.js';
import { TransferProvider } from './transfer.provider.js';

@Injectable()
export class PayoutTransferProvider implements TransferProvider {
  // ASSUMPTION: the provider SDK import/credential wiring is not specified;
  // the concrete transfer call and auth come from the deployment environment.
  async transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    try {
      // Replace with the real provider SDK call, e.g.:
      //   const tx = await sdk.transfer({ to: input.to, amount: input.amount });
      //   return { txHash: tx.txHash };
      throw new TransferDefinitiveError('provider not wired');
    } catch (err) {
      throw err;
    }
  }
}
