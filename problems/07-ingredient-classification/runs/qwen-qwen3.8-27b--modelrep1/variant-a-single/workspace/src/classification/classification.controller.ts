import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { ClassificationService } from './classification.service.js';
import type { ClassificationOutput, StoredClassificationResponse } from './classification.types.js';

export class ClassifyDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  profileId?: string;
}

export class GetClassificationQueryDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  methodologyVersionId?: string;
}

@Controller('classifications')
export class ClassificationController {
  constructor(@Inject(ClassificationService) private readonly service: ClassificationService) {}

  @Post()
  @HttpCode(200)
  classify(@Body() dto: ClassifyDto): Promise<ClassificationOutput> {
    return this.service.classify(dto.productId, dto.profileId);
  }

  @Get()
  getStored(@Query() query: GetClassificationQueryDto): Promise<StoredClassificationResponse> {
    return this.service.getStored(query.productId, query.methodologyVersionId);
  }
}
