import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { SEVERITIES, type Severity, type VersionSummary } from '../classification/classification.types.js';
import { MethodologyService, type PublishResult } from './methodology.service.js';

export class CreateRuleDto {
  @IsString()
  @IsNotEmpty()
  ingredient!: string;

  @IsIn(SEVERITIES)
  severity!: Severity;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;
}

export class CreateMethodologyVersionDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRuleDto)
  rules!: CreateRuleDto[];
}

@Controller('methodology-versions')
export class MethodologyController {
  constructor(@Inject(MethodologyService) private readonly service: MethodologyService) {}

  @Post()
  create(@Body() dto: CreateMethodologyVersionDto): Promise<VersionSummary> {
    return this.service.create(dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string): Promise<PublishResult> {
    return this.service.publish(id);
  }
}
