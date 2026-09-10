import { Body, Controller, Post } from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';
import { AppError } from '../common/app-error.js';
import { DriftRepairResult, ProjectionService, RederiveResult } from './projection.service.js';

export class ProjectionWindowDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class RepairWindowDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

@Controller('projection')
export class ProjectionController {
  constructor(private readonly projection: ProjectionService) {}

  @Post('re-derive')
  rederive(@Body() body: ProjectionWindowDto): Promise<RederiveResult> {
    return this.projection.rederive(new Date(body.from), new Date(body.to));
  }

  @Post('drift-repair')
  async repair(@Body() body: RepairWindowDto): Promise<DriftRepairResult> {
    if (Boolean(body.from) !== Boolean(body.to)) {
      throw new AppError(400, 'validation_failed', 'Provide both `from` and `to`, or neither to use the default window.', {
        from: body.from ?? null,
        to: body.to ?? null,
      });
    }
    if (body.from && body.to) {
      return this.projection.repairDrift(new Date(body.from), new Date(body.to));
    }
    const { from, to } = this.projection.defaultWindow();
    return this.projection.repairDrift(from, to);
  }
}
