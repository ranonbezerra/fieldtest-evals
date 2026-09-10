import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module.js';
import { ContentModule } from '../content/content.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchorsController } from './anchors.controller.js';
import { AnchorsRepository } from './anchors.repository.js';
import { AnchorsService } from './anchors.service.js';
import {
  AnchorWorkersService,
  ConfirmationWorkerService,
  RecoverySweepService,
} from './anchors.worker.js';

@Module({
  imports: [PrismaModule, ChainModule, ContentModule],
  controllers: [AnchorsController],
  providers: [
    AnchorsRepository,
    AnchorsService,
    ConfirmationWorkerService,
    RecoverySweepService,
    AnchorWorkersService,
  ],
})
export class AnchorsModule {}
