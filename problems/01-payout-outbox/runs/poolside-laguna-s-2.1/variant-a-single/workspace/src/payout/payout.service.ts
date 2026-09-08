import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import { PAYOUT_PROVIDER, type PayoutProvider, type TransientProviderError as TPE, isTransientError } from './payout.provider';
