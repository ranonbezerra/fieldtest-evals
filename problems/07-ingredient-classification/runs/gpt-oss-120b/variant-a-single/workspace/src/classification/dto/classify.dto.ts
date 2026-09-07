import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ClassifyDto {
  @IsInt()
  @Type(() => Number)
  productId!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  profileId?: number;
}
