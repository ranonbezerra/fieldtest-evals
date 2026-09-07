import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ExportService } from './exports.service.js';
import { ExportsRepository } from './exports.repository.js';

@Module({
  providers: [ExportService, ExportsRepository],
  exports: [ExportService],
  imports: [PrismaModule],
})
export class ExportsModule {}
