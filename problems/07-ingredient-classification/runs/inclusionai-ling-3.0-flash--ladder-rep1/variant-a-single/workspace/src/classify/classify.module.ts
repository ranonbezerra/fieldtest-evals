import { Module } from '@nestjs/common';
import { ClassifyService } from './classify.service.js';
import { ClassifyRepository } from './classify.repository.js';
import { ClassifyController } from './classify.controller.js';

@Module({
  providers: [ClassifyService, ClassifyRepository],
  exports: [ClassifyService, ClassifyRepository],
  controllers: [ClassifyController],
})
export class ClassifyModule {}
