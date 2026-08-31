import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { ChainClient, FakeChainClient } from './chain';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    { provide: ChainClient, useClass: FakeChainClient },
  ],
})
export class AnchorModule {}
