import { OrderStatus, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GetOperationsQueryDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class CompanyIdQueryDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;
}

export class GetWindowDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

/** Normalized shape of a source order as consumed by the projection hooks. */
export interface OrderSnapshot {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: OrderStatus;
  amount: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  worker: { name: string } | null;
  event: { name: string; startedAt: Date } | null;
}

export interface OperationRowDto {
  id: string;
  status: OrderStatus;
  workerId: string | null;
  workerName: string | null;
  eventId: string | null;
  eventName: string | null;
  eventStartedAt: Date | null;
  amount: Prisma.Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanyTotalsDto {
  orderCount: number;
  approvedCount: number;
  approvedAmount: string;
  totalAmount: string;
}

export interface OperationsPage {
  data: OperationRowDto[];
  page: number;
  pageSize: number;
  total: number;
  totals: CompanyTotalsDto;
}

export interface WindowRef {
  from: Date;
  to: Date;
}

export interface RederiveResult {
  window: WindowRef;
  rebuiltRows: number;
  companiesRepaired: number;
}

export interface DriftReport {
  window: WindowRef;
  missingRows: number;
  staleRows: number;
  orphanRows: number;
  rebuiltRows: number;
  companiesRepaired: number;
}
