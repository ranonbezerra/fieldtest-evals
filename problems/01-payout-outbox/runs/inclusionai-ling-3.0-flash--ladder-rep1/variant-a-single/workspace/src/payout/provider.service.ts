import { Injectable } from "@nestjs/common";
import { Provider } from "./payout.types.js";

@Injectable()
export class ProviderService implements Provider {
  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    // ASSUMPTION: delegates to external blockchain provider SDK
    // In production: return providerSdk.transfer({ to, amount });
    throw new Error("Provider not configured");
  }

  async confirm(txHash: string): Promise<boolean> {
    // ASSUMPTION: checks blockchain for transaction confirmation
    throw new Error("Provider not configured");
  }
}
