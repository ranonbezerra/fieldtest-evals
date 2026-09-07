import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ClassificationService } from './classification.service.js';
import { ClassifyDto } from './dto/classify.dto.js';
import { validateOrReject } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Controller('classify')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post()
  async classify(@Body() body: any) {
    const dto = plainToInstance(ClassifyDto, body);
    try {
      await validateOrReject(dto);
    } catch (err) {
      throw new HttpException(
        { error: { code: 'validation_failed', message: 'Invalid input', details: err } },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.classificationService.classify(dto.productId, dto.profileId);
      return result;
    } catch (e: any) {
      throw new HttpException(
        { error: { code: 'resource_not_found', message: e.message, details: {} } },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
