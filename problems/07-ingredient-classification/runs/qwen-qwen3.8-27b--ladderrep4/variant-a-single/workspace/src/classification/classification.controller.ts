import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { asRecord, optionalPositiveInt, optionalString, requireString } from '../common/validate.js';
import {
  type ClassificationOutput,
  type StoredResultView,
  ClassificationService,
} from './classification.service.js';

@Controller('classifications')
export class ClassificationController {
  constructor(@Inject(ClassificationService) private readonly service: ClassificationService) {}

  @Post()
  async classify(@Body() body: unknown): Promise<ClassificationOutput> {
    const record = asRecord(body, 'body');
    const productId = requireString(record, 'productId');
    const profileId = optionalString(record, 'profileId');
    return this.service.classify(productId, profileId);
  }

  @Get()
  async getResults(@Query() query: unknown): Promise<StoredResultView[]> {
    const record = asRecord(query, 'query');
    const productId = requireString(record, 'productId');
    const methodologyVersion = optionalPositiveInt(record, 'methodologyVersion');
    const profileId = optionalString(record, 'profileId');
    return this.service.getResults(productId, methodologyVersion, profileId);
  }
}
