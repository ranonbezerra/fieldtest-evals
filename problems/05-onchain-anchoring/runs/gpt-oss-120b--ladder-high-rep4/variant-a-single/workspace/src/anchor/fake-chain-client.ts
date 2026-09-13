import { IChainClient } from './chain-client.interface';
import { v4 as uuidv4 } from 'uuid';

export class FakeChainClient implements IChainClient {
  async prepare(tx: any) {
    const txId = uuidv4();
    const signedTx = `signed-${JSON.stringify(tx)}`;
    return { txId, signedTx };
  }

  async broadcast(signedTx: string) {
    // Simulate a broadcast that may timeout; here we just resolve immediately.
    return;
  }

  async getReceipt(txId: string) {
    // Return a fake receipt.
    return { txId, blockNumber: Math.floor(Math.random() * 100000) };
  }
}
