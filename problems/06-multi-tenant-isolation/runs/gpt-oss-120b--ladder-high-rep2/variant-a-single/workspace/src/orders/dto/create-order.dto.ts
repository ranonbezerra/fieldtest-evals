import { IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  planId: string;
}
