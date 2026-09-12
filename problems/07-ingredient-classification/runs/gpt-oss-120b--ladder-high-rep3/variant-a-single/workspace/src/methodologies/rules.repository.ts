import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Rule, Severity } from '@prisma/client';

@Injectable()
export class RulesRepository {
  // ... (rest of the file remains unchanged)
}
