import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CHAIN_CLIENT } from './chain.client';
import { REPORT_SOURCE } from './report.source';
import { FakeChainClient } from './fake-chain.client';
import { FakeReportSource } from './fake-report.source';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorConfirmationWorker } from './anchor.worker';
import { AnchorRecoverySweep } from './anchor.sweep';

/**
 * No real keys or RPC: the chain client and the report store are wired as
 * fakes behind their interfaces; a production deployment swaps the
 * useClass bindings for real implementations.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorConfirmationWorker,
    AnchorRecoverySweep,
    { provide: CHAIN_CLIENT, useClass: FakeChainClient },
    { provide: REPORT_SOURCE, useClass: FakeReportSource },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
