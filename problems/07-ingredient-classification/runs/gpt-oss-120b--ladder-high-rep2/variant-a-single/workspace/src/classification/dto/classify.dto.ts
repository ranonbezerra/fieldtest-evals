import { IsOptional, IsUUID } from 'class-validator';

export class ClassifyDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  profileId?: string;
}
