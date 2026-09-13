import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ClassificationService } from './classification.service.js';
import { ClassificationResultDto } from './dto/classification-result.dto.js';

@Controller('classify')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get(':productId')
  async classify(
    @Param('productId') productId: string,
    @Query('profileId') profileId?: string,
    @Query('version') version?: string,
  ): Promise<ClassificationResultDto> {
    const pid = parseInt(productId, 10);
    if (isNaN(pid)) {
      throw new HttpException(
        {
          error: {
            code: 'bad_request',
            message: 'Invalid productId',
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const profId = profileId ? parseInt(profileId, 10) : undefined;
    const result = await this.classificationService.classify(pid, profId, version);
    if (!result) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'Classification result not found',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }
}
