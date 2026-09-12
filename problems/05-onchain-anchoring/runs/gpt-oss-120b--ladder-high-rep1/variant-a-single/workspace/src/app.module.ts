import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [AnchorModule],
  providers: [PrismaService],
})
export class AppModule {}
