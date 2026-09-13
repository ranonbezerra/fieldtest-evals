import { Injectable } from "@nestjs/common";
import { MethodologyRepository } from "./methodology.repository.js";
import { ClassificationService } from "../classification/classification.service.js";
import { AppException } from "../common/app-exception.js";

@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepo: MethodologyRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async createVersion(version: string): Promise<any> {
    return this.methodologyRepo.createVersion(version);
  }

  async getVersion(id: string): Promise<any | null> {
    return this.methodologyRepo.findById(id);
  }

  async getActive(): Promise<any | null> {
    return this.methodologyRepo.getActiveVersion();
  }

  async addRule(versionId: string, ruleData: {
    name: string;
    ingredientName: string;
    severity: string;
    sourceCitation: string;
    source: string;
  }): Promise<any> {
    const version = await this.methodologyRepo.findById(versionId);
    if (!version) {
      throw new AppException("methodology_version_not_found", "Methodology version not found", 404);
    }
    return this.methodologyRepo.addRule(versionId, ruleData);
  }

  async publishVersion(versionId: string): Promise<void> {
    const version = await this.methodologyRepo.findById(versionId);
    if (!version) {
      throw new AppException("methodology_version_not_found", "Methodology version not found", 404);
    }
    await this.methodologyRepo.publishVersion(versionId);
    await this.classificationService.rescoreProducts(versionId);
  }
}
