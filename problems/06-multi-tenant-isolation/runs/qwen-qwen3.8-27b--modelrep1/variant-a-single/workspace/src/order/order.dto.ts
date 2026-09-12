import { IsIn, IsUUID } from 'class-validator';

export const ORDER_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export class CreateOrderDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;
}

export class UpdateOrderDto {
  @IsIn(['PENDING', 'COMPLETED', 'CANCELLED'])
  status!: OrderStatus;
}
