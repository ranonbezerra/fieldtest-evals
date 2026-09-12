import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';
import { UsersService } from './users.service.js';

@Module({
  providers: [UsersService, ExportService],
  exports: [UsersService, ExportService],
})
export class UsersModule {}
