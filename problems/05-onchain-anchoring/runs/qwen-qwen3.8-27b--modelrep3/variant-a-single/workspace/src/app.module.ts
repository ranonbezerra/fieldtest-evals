import { Module } from '@nestjs/common';
import { AnchorsModule } from './anchors/anchors.module.js';
import { ChainModule } from './chain/chain.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, ChainModule, DocumentsModule, AnchorsModule],
})
export class AppModule {}
