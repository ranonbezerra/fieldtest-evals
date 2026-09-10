import { Body, Controller, Post } from '@nestjs/common';
import { IsDateString } from 'class-validator';
import { RederivationService } from './rederivation.service.js';

export class RederiveWindowDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

@Controller('rederivations')
export class RederivationController {
  constructor(private readonly rederivation: RederivationService) {}

  @Post()
  rederive(@Body() dto: RederiveWindowDto) {
    return this.rederivation.rederive(new Date(dto.from), new Date(dto.to));
  }
}
