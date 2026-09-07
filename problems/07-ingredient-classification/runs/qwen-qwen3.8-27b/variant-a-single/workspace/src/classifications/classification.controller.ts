import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength, IsUUID } from 'class-validator';
import { ClassificationService } from './classification.js';

class ClassifyDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  profileId?: string;
}

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classifications: ClassificationService) {}

  @Post()
  classify(@Body() body: ClassifyDto) {
    return this.classifications.classify(body.productId, body.profileId ?? null);
  }

  @Get(':productId')
  retrieve(@Param('productId') productId: string, @Query('version') version?: string) {
    return this.classifications.retrieve(productId, version ?? undefined);
  }
}
