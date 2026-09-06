import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications/notifications.module.js';
import { UsersModule } from './users/users.module.js';
import { ExportModule } from './export/export.module.js';
import { RetryModule } from './retry/retry.module.js';

@Module({
  imports: [NotificationsModule, UsersModule, ExportModule, RetryModule],
})
export class AppModule {}
