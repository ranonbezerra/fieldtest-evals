// src/order/order.dto.ts

import { IsString, IsNumber, IsOptional, IsEnum, IsUUID, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// NOTE: The exact shape of the Order model is not provided in the task description.
// We assume typical fields that an order might contain. Adjust the fields as needed
// to match the actual Prisma schema when it becomes available.

// -------------------------------------------------------------
// CreateOrderDto – used when creating a new order
// -------------------------------------------------------------
export class CreateOrderDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @IsOptional()
  @Type(() => String)
  currency?: string;

  @IsEnum(['PENDING', 'COMPLETED', 'CANCELLED'])
  @IsOptional()
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
}

// -------------------------------------------------------------
// UpdateOrderDto – used when updating an existing order
// -------------------------------------------------------------
export class UpdateOrderDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'COMPLETED', 'CANCELLED'])
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
}
