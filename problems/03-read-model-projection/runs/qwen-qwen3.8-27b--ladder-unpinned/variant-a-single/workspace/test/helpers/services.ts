import { DriftRepairService } from '../../src/drift-repair/drift-repair.service';
import { DriftRepairRepository } from '../../src/drift-repair/drift-repair.repository';
import { ProjectionService } from '../../src/projection/projection.service';
import { ProjectionRepository } from '../../src/projection/projection.repository';
import { OperationsService } from '../../src/operations/operations.service';
import { OperationsRepository } from '../../src/operations/operations.repository';
import type { PrismaClient } from '@prisma/client';

// ASSUMPTION: ProjectionService constructor takes a single ProjectionRepository argument.
// ASSUMPTION: OperationsService constructor takes a single OperationsRepository argument.

export function createDriftRepairRepository(db: PrismaClient): DriftRepairRepository {
  return new DriftRepairRepository(db);
}

export function createProjectionService(
  repository: ProjectionRepository,
): ProjectionService {
  return new ProjectionService(repository);
}

export function createDriftRepairService(
  repository: DriftRepairRepository,
  projectionService: ProjectionService,
): DriftRepairService {
  return new DriftRepairService(repository, projectionService);
}

export function createOperationsService(
  repository: OperationsRepository,
): OperationsService {
  return new OperationsService(repository);
}
