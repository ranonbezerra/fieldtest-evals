export interface OperationDto {
  id: number;
  orderId: number;
  workerId: number;
  amountCents: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
