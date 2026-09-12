import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { ExportsController } from './exports.controller.js';

@Module({
  imports: [UsersModule],
  controllers: [ExportsController],
})
export class ExportsModule {}
