import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [ClassificationModule],
})
export class AppModule {}
