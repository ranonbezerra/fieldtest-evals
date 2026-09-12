import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassificationResultDto } from './dto/classification-result.dto';
import { ClassifyDto } from './dto/classify.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('classifications')
@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post()
  @ApiOperation({ summary: 'Classify a product' })
  @ApiResponse({
    status: 200,
    description: 'Classification result',
    type: ClassificationResultDto,
  })
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResultDto> {
    const { productId, profileId } = dto;
    return this.classificationService.classify(productId, profileId);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get stored classification result' })
  @ApiResponse({
    status: 200,
    description: 'Stored result',
    type: ClassificationResultDto,
  })
  async getResult(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('version') version?: string,
  ): Promise<ClassificationResultDto> {
    return this.classificationService.getResult(productId, version);
  }
}
