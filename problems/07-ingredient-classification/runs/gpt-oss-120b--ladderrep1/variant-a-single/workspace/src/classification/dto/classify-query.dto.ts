import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ClassifyQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;
}
