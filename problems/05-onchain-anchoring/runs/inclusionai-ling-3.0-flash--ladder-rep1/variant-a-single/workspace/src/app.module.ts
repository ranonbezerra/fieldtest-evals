import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AnchorModule } from './anchor/anchor.module.js';

@Module({
  imports: [PrismaModule, AnchorModule],
})
export class AppModule {}
