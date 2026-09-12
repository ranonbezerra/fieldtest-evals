import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule, NotificationsModule, ExportsModule, JobsModule],
})
export class AppModule {}
