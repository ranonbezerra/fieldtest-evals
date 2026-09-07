import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [ClassificationModule],
  providers: [PrismaService],
})
export class AppModule {}
