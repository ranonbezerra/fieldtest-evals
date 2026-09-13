import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorConfirmationService } from './anchor-confirmation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IChainClient } from './chain-client.interface';
import { FakeChainClient } from './fake-chain-client';
