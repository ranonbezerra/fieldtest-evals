import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClassifyDto {
  @ApiProperty({ description: 'ID of the product to classify' })
  @IsInt()
  @Min(1)
  productId: number;

  @ApiPropertyOptional({ description: 'Optional profile ID for contextual modifiers' })
  @IsOptional()
  @IsInt()
  @Min(1)
  profileId?: number;
}
