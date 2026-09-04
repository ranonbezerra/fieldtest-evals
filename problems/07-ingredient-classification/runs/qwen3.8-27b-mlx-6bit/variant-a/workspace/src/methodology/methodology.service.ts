import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';
import { ClassificationService } from '../classification/classification.service.js';
import { ConflictError, ResourceNotFound } from '../classification/types.js';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repository: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async publish(versionId: number): Promise<void> {
    const version = await this.repository.getById(versionId);
    if (!version) {
      throw new ResourceNotFound(`Methodology version ${versionId} not found`);
    }
    if (version.isActive) {
      throw new ConflictError(`Methodology version ${versionId} is already active`);
    }

    await this.repository.publish(versionId);
    await this.classificationService.rescoreAll(versionId);
  }
}
