import { Module } from '@nestjs/common';
import { AnchorsModule } from './anchors/anchors.module.js';

@Module({
  imports: [AnchorsModule],
})
export class AppModule {}
