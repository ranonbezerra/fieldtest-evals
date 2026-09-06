import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { ExportModule } from '../export/export.module.js';

@Module({
  providers: [UsersService],
  imports: [ExportModule],
})
export class UsersModule {}
