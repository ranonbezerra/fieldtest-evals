import { Module } from "@nestjs/common";
import { ClassificationService } from "./classification.service.js";
import { ClassificationRepository } from "./classification.repository.js";
import { ClassificationController } from "./classification.controller.js";
import { ProductModule } from "../product/product.module.js";
import { MethodologyModule } from "../methodology/methodology.module.js";
import { ProfileModule } from "../profile/profile.module.js";
import { SynonymModule } from "../synonym/synonym.module.js";
import { IngredientModule } from "../ingredient/ingredient.module.js";

@Module({
  imports: [
    ProductModule,
    MethodologyModule,
    ProfileModule,
    SynonymModule,
    IngredientModule,
  ],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
