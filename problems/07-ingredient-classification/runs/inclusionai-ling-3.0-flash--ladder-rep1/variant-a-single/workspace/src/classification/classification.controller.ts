import { Controller, Post, Get, Body, Param, Query } from "@nestjs/common";
import { ClassificationService } from "./classification.service.js";

@Controller("classification")
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post("classify")
  async classify(
    @Body("productId") productId: string,
    @Body("profileId") profileId?: string,
  ) {
    return this.classificationService.classify(productId, profileId);
  }

  @Post("rescore")
  async rescore(@Body("versionId") versionId: string) {
    await this.classificationService.rescoreProducts(versionId);
    return { success: true };
  }

  @Post("version/:versionId/classify")
  async classifyWithVersion(
    @Param("versionId") versionId: string,
    @Body("productId") productId: string,
    @Body("profileId") profileId?: string,
  ) {
    return this.classificationService.classifyWithVersion(
      productId,
      versionId,
      profileId,
    );
  }

  @Get("result")
  async getResult(
    @Query("productId") productId: string,
    @Query("versionId") versionId: string,
    @Query("profileId") profileId?: string,
  ) {
    return this.classificationService.getResult(
      productId,
      versionId,
      profileId ?? null,
    );
  }
}
