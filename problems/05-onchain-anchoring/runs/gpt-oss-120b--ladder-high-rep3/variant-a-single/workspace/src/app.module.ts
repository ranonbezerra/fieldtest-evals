import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { AnchorModule } from './anchor/anchor.module.js';

@Module({
  imports: [AnchorModule],
  providers: [PrismaService],
})
export class AppModule {}
