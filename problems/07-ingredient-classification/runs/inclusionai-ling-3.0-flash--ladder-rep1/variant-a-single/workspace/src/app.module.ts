import { Module } from "@nestjs/common";
import { ProductModule } from "./product/product.module.js";
import { MethodologyModule } from "./methodology/methodology.module.js";
import { ProfileModule } from "./profile/profile.module.js";
import { SynonymModule } from "./synonym/synonym.module.js";
import { ClassificationModule } from "./classification/classification.module.js";

@Module({
  imports: [
    ProductModule,
    MethodologyModule,
    ProfileModule,
    SynonymModule,
    ClassificationModule,
  ],
})
export class AppModule {}
