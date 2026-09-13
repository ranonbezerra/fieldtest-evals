import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';

@Module({
  imports: [AnchorModule],
})
export class AppModule {}
