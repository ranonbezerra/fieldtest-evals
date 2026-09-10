import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountCents!: number;
}
