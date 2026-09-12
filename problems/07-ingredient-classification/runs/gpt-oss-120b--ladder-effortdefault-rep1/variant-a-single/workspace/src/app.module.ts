import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module';

@Module({
  imports: [ClassificationModule],
})
export class AppModule {}
