import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { CLASSIFICATION_REPOSITORY, ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';

@Module({
  controllers: [ClassificationController],
  providers: [
    ClassificationRepository,
    { provide: CLASSIFICATION_REPOSITORY, useExisting: ClassificationRepository },
    ClassificationService,
  ],
})
export class ClassificationModule {}
