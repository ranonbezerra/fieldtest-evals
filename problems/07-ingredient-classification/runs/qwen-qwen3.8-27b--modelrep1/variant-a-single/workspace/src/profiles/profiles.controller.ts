import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SEVERITIES, type ProfileRef, type Severity } from '../classification/classification.types.js';
import { ProfilesService } from './profiles.service.js';

export class ProfileModifierDto {
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

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProfileModifierDto)
  modifiers!: ProfileModifierDto[];
}

@Controller('profiles')
export class ProfilesController {
  constructor(@Inject(ProfilesService) private readonly service: ProfilesService) {}

  @Post()
  create(@Body() dto: CreateProfileDto): Promise<ProfileRef> {
    return this.service.create(dto);
  }

  @Get()
  list(): Promise<ProfileRef[]> {
    return this.service.list();
  }
}
