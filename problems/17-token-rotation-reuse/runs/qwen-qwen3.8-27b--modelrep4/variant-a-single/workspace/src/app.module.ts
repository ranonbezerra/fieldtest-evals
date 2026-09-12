import { Module } from '@nestjs/common';
import { RefreshModule } from './refresh/refresh.module.js';

@Module({
  imports: [RefreshModule],
})
export class AppModule {}
