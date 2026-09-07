// src/prisma/prisma.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// ASSUMPTION: PrismaService is correctly implemented (see src/prisma/prisma.service.ts)
// and handles tenant‑scoping internally. No other providers are required here.

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
