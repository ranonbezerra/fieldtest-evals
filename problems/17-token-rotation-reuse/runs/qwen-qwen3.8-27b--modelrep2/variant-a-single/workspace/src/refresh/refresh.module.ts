import { Module } from '@nestjs/common';

import { RefreshController } from './refresh.controller.js';
import { RefreshService, REFRESH_CLOCK } from './refresh.service.js';
import { RefreshTokenRepository } from './refresh.repository.js';

@Module({
  controllers: [RefreshController],
  providers: [
    { provide: REFRESH_CLOCK, useValue: () => new Date() },
    RefreshService,
    RefreshTokenRepository,
  ],
  exports: [RefreshService],
})
export class RefreshModule {}
