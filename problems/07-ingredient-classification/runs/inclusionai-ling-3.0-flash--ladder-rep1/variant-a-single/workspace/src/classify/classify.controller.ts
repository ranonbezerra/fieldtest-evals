import { Controller, Post, Get, Param, Query, Body, Req } from '@nestjs/common';
import { ClassifyService } from './classify.service.js';
import { ClassifyRepository, ClassificationResultDto } from './classify.repository.js';

@Controller('classify')
export class ClassifyController {
  constructor(
    private readonly classifyService: ClassifyService,
    private readonly repository: ClassifyRepository,
  ) {}

  @Post(':productId')
  async classify(
    @Param('productId') productId: string,
    @Query('profileId') profileId?: string,
  ): Promise<ClassificationResultDto> {
    return this.classifyService.classify(productId, profileId);
  }

  @Get(':productId/results')
  async getResults(
    @Param('productId') productId: string,
    @Query('versionId') versionId: string,
  ): Promise<ClassificationResultDto | null> {
    return this.repository.getResult(productId, versionId);
  }
}
