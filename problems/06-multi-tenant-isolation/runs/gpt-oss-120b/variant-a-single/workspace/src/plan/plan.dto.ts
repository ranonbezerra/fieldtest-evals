// src/plan/plan.dto.ts

import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO for creating a new Plan.
 *
 * The business requirements (see PLAN.md) dictate that a plan has:
 * - a name (string, required, max length 100)
 * - a description (string, optional, max length 500)
 * - a price (number, required, must be >= 0)
 * - a tenantId is **not** passed by callers – it is injected by the tenant‑aware Prisma
 *   middleware, so we deliberately omit it here.
 */
export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumber()
  @Min(0)
  @Transform(({ value }) => Number(value))
  price!: number;
}

/**
 * DTO for updating an existing Plan.
 *
 * All fields are optional because a partial update is allowed.
 * Validation mirrors the rules from CreatePlanDto where applicable.
 */
export class UpdatePlanDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  price?: number;
}
