import { Module } from '@nestjs/common';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyService } from './methodology.service.js';
import { MethodologyRepository } from './methodology.repository.js';
import { ClassificationModule } from '../classification/classification.module.js';

@Module({
  imports: [ClassificationModule],
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}
