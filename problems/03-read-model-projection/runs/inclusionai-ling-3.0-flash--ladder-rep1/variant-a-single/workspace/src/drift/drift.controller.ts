import { Controller, Get, Query } from '@nestjs/common';
import { DriftService } from './drift.service.ts';

@Controller('drift')
export class DriftController {
  constructor(private readonly driftService: DriftService) {}

  @Get('repair')
  async repair(@Query('windowDays') windowDays?: string) {
    return this.driftService.runRepair(windowDays ? parseInt(windowDays, 10) : 7);
  }
}
