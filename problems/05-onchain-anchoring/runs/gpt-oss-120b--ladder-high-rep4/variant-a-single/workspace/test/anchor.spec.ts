import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AnchorModule } from '../src/anchor/anchor.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorConfirmationService } from '../src/anchor/anchor-confirmation.service';
import { FakeChainClient } from '../src/anchor/fake-chain-client';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../src/common/api-exception';
