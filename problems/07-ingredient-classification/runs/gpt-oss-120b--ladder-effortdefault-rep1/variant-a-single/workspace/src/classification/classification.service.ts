import { Injectable, BadRequestException } from '@nestjs/common';
import {
  ClassificationResult,
  ClassificationFinding,
  MethodologyVersion,
  Severity,
} from '@prisma/client';
import { ClassificationRepository } from './classification.repository';
import { Finding } from './interfaces';
import { normalizeString } from '../utils/normalize';

@Injectable()
export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository) {}

  async getActiveMethodologyVersion(): Promise<MethodologyVersion> {
    const version = await this.repo.getActiveMethodologyVersion();
    if (!version) {
      throw new BadRequestException('No active methodology version');
    }
    return version;
  }

  async getStoredResult(
    productId: number,
    versionId: number,
  ): Promise<ClassificationResult | null> {
    return this.repo.getClassificationResult(productId, versionId);
  }

  /**
   * Main entry point
   */
  async classify(productId: number, profileId?: number) {
    const version = await this.getActiveMethodologyVersion();
    const rawIngredients = await this.repo.getProductIngredients(productId);
    if (!rawIngredients) {
      throw new BadRequestException('Product not found');
    }

    // Resolve ingredients (order‑independent processing)
    const resolved = rawIngredients.map((ri) => ({
      raw: ri.rawName,
      ingredient: this.repo.resolveIngredient(ri.rawName),
    }));

    // Load base rules once
    const baseRules = await this.repo.getAllRulesForVersion(version.id);

    // Load profile modifiers if needed
    const modifiers = profileId
      ? await this.repo.getModifiersForProfile(profileId)
      : [];

    const findings: Finding[] = [];

    for (const { raw, ingredient } of resolved) {
      if (!ingredient) {
        // Unknown ingredient
        findings.push({
          rawName: raw,
          ingredientId: null,
          isUnknown: true,
          flag: false,
          severity: null,
          sourceCitation: null,
        });
        continue;
      }

      // Base rule lookup
      const rule = baseRules.find((r) => r.ingredientId === ingredient.id);
      let flag = !!rule;
      let severity: Severity | null = rule ? rule.severity : null;
      let sourceCitation: string | null = rule ? rule.sourceCitation : null;

      // Apply profile modifiers (override if defined)
      const mod = modifiers.find((m) => m.ingredientId === ingredient.id);
      if (mod) {
        if (typeof mod.overrideFlag === 'boolean') flag = mod.overrideFlag;
        if (mod.overrideSeverity) severity = mod.overrideSeverity;
      }

      findings.push({
        rawName: raw,
        ingredientId: ingredient.id,
        isUnknown: false,
        flag,
        severity,
        sourceCitation,
      });
    }

    // Confidence = recognised / total
    const confidence =
      rawIngredients.length === 0
        ? 0
        : findings.filter((f) => !f.isUnknown).length / rawIngredients.length;

    const disclaimer = `Classification based on methodology version ${version.name}`;

    // Persist result (idempotent upsert)
    const storedResult = await this.repo.upsertClassificationResult(
      productId,
      version.id,
      confidence,
      disclaimer,
      findings,
    );

    return storedResult;
  }

  /**
   * Re‑score every product against the current active methodology version.
   * Idempotent – existing rows are upserted.
   */
  async rescoreAll(): Promise<void> {
    const version = await this.getActiveMethodologyVersion();
    const productIds = await this.repo.getAllProductIds();

    for (const pid of productIds) {
      // No profile supplied – just the base methodology
      await this.classify(pid);
    }
  }
}
