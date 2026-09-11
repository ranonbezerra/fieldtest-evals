import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaModule } from './common/prisma.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
