import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor-state.enum.js';

@Injectable()
export class AnchorWorkerService {
  constructor(
    private readonly repository: AnchorRepository,
    @Inject('ChainClient') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Processes anchors that are pending confirmation.
   * For each anchor:
   *   - Query the chain for a receipt.
   *   - If receipt exists, mark as CONFIRMED.
   *   - If no receipt and the anchor is in BROADCAST_UNKNOWN, re‑broadcast the same signed transaction.
   */
  async processPending(): Promise<void> {
    const pending = await this.repository.findByStates([AnchorState.BROADCASTED, AnchorState.BROADCAST_UNKNOWN]);

    for (const anchor of pending) {
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        await this.repository.updateToConfirmed(anchor.id, receipt.blockNumber);
        continue;
      }

      if (anchor.state === AnchorState.BROADCAST_UNKNOWN) {
        try {
          await this.chainClient.broadcast(anchor.signedTx);
          await this.repository.updateState(anchor.id, AnchorState.BROADCASTED);
        } catch (e) {
          // If broadcast still times out, keep state as BROADCAST_UNKNOWN for future retries.
        }
      }
    }
  }
}
