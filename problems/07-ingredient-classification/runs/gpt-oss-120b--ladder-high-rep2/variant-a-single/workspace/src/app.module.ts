import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [ClassificationModule],
  providers: [PrismaService],
})
export class AppModule {}
