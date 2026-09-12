import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';
import { PrismaService } from './prisma.service.js';
import { FakeBlockchainService } from './blockchain/fake-blockchain.service.js';
import { BlockchainClient } from './blockchain/blockchain.client.js';

@Module({
  imports: [AnchorModule],
  providers: [
    PrismaService,
    { provide: 'BlockchainClient', useClass: FakeBlockchainService },
  ],
  exports: [PrismaService],
})
export class AppModule {}
