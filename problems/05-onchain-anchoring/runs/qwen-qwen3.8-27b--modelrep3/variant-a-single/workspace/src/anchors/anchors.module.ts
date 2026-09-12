import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { AnchorsController } from './anchors.controller.js';
import { AnchorsProcessor } from './anchors.processor.js';
import { AnchorsRepository } from './anchors.repository.js';
import { AnchorsService } from './anchors.service.js';

@Module({
  imports: [ChainModule, DocumentsModule],
  controllers: [AnchorsController],
  providers: [AnchorsService, AnchorsRepository, AnchorsProcessor],
  exports: [AnchorsService],
})
export class AnchorsModule {}
