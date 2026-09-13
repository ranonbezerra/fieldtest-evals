import { Module } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';
import { MethodologyRepository } from './methodology.repository.js';
import { MethodologyController } from './methodology.controller.js';
import { ClassifyModule } from '../classify/classify.module.js';
import { ProductsModule } from '../products/products.module.js';

@Module({
  imports: [ClassifyModule, ProductsModule],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService, MethodologyRepository],
  controllers: [MethodologyController],
})
export class MethodologyModule {}
