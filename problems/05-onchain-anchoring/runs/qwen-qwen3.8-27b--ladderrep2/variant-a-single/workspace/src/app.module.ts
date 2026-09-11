import { Module } from '@nestjs/common';
import { AnchoringModule } from './anchoring/anchoring.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AnchoringModule],
})
export class AppModule {}
