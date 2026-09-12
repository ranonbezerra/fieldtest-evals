import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { assertObject, assertUuid } from '../common/validate.js';
import { ClassificationService } from './classification.service.js';

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classifications: ClassificationService) {}

  @Post()
  classify(@Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const productId = assertUuid(payload['productId'], 'productId');
    const profileId =
      payload['profileId'] === undefined || payload['profileId'] === null
        ? undefined
        : assertUuid(payload['profileId'], 'profileId');
    return this.classifications.classify(productId, profileId);
  }

  @Get()
  getStored(
    @Query('productId') productId: string | undefined,
    @Query('methodologyVersionId') methodologyVersionId: string | undefined,
  ) {
    const pid = assertUuid(productId, 'productId');
    if (methodologyVersionId === undefined || methodologyVersionId === '') {
      return this.classifications.listStoredForProduct(pid);
    }
    return this.classifications.getStored(pid, assertUuid(methodologyVersionId, 'methodologyVersionId'));
  }
}
