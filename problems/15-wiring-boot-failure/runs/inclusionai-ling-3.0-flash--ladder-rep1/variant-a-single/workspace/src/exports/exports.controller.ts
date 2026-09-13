import { Body, Controller, Post } from '@nestjs/common';
import { ExportService, type ExportJob } from '../users/export.service.js';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportService) {}

  @Post()
  async create(@Body() body: { requestedBy: string }): Promise<ExportJob> {
    return this.exports.enqueue(body.requestedBy);
  }
}
