import { Module } from '@nestjs/common';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [OperationsModule],
})
export class AppModule {}
