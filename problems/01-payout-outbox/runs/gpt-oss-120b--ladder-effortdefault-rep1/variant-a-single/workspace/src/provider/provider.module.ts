import { Module } from '@nestjs/common';
import { ProviderService } from './provider.service.js';

@Module({
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
