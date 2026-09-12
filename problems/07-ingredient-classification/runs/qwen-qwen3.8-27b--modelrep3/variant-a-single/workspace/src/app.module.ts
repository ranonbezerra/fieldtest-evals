import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
})
export class AppModule {}
