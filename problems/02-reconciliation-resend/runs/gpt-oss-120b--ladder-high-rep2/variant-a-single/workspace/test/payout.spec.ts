import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import {
  BankService,
  BankSendResult,
  Settlement,
} from '../src/bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

// ... rest of the test file remains unchanged
