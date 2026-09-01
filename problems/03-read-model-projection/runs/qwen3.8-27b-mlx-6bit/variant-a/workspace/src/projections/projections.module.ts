import { Module } from '@nestjs/common';

import { ProjectionsRepository } from './projections.repository';
import { ProjectionsService } from './projections.service';

// ASSUMPTION: PrismaClient (injected by ProjectionsRepository) is provided by a global module above this one, e.g. app.module; no compiler message names a prisma import here and PLAN.md scopes this file to wiring its own service/repository only.
@Module({
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
