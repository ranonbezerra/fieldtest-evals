export interface PayoutDto {
  id: string;
  accountId: string;
  amount: string; // stringified bigint
  destinationAddress: string;
  status: string;
  createdAt: Date;
}
