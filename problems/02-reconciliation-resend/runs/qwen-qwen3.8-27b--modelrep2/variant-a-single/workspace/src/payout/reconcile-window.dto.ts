import { Type } from 'class-transformer';
import { IsDateString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class ReconcileWindowDto {
  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  from?: string;

  @IsOptional()
  @IsDateString()
  @MinLength(10)
  @MaxLength(10)
  @Type(() => String)
  to?: string;
}
