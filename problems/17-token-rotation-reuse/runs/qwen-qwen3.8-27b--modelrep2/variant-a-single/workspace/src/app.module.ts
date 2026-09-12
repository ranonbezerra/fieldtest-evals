import { Module } from '@nestjs/common';

import { RefreshModule } from './refresh/refresh.module.js';

// The pre-existing sign-in module (assumed by the task) is imported alongside
// RefreshModule here in a full deployment.
@Module({
  imports: [RefreshModule],
})
export class AppModule {}
