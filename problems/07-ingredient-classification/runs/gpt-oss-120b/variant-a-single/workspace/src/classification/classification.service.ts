import { Injectable, NotFoundException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository.js';
import {
  ClassificationResult,
  ClassificationFinding,
  Severity,
} from '@prisma/client';

type IngredientMatch = {
  ingredientId: number | null;
  recognized: boolean;
  raw: string;
};

@Injectable()
export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository) {}

  // Normalization: lower case, trim, Unicode NFD remove diacritics
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private async resolveIngredient(raw: string): Promise<IngredientMatch> {
    const normalized = this.normalize(raw);
    // Try exact ingredient name
    const ingredient = await this.repo.findIngredientByNormalizedName(normalized);
    if (ingredient) {
      return { ingredientId: ingredient.id, recognized: true, raw };
    }
    // Try synonym
    const synonym = await this.repo.findSynonymByNormalizedName(normalized);
    if (synonym) {
      return { ingredientId: synonym.ingredientId, recognized: true, raw };
    }
    return { ingredientId: null, recognized: false, raw };
  }

  async classify(productId: number, profileId?: number) {
    const product = await this.repo.getProductWithIngredients(productId);
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    const activeMethodology = await this.repo.getActiveMethodologyVersion();
    if (!activeMethodology) throw new NotFoundException('No active methodology version');

    const baseRules = await this.repo.getRulesByMethodologyVersion(activeMethodology.id);
    const ruleMap = new Map<number, { severity: Severity; sourceCitation: string }>();
    baseRules.forEach(r => {
      ruleMap.set(r.ingredientId, { severity: r.severity, sourceCitation: r.sourceCitation });
    });

    const profileOverrides = profileId
      ? await this.repo.getProfileOverrides(profileId)
      : [];
    const overrideMap = new Map<number, Severity>();
    profileOverrides.forEach(o => overrideMap.set(o.ingredientId, o.severity));

    const findings: ClassificationFinding[] = [];
    let recognizedCount = 0;

    for (const entry of product.ingredientEntries) {
      const match = await this.resolveIngredient(entry.raw);
      let severity: Severity | null = null;
      let sourceCitation: string | null = null;
      let flagged = false;

      if (match.recognized && match.ingredientId !== null) {
        recognizedCount++;
        const base = ruleMap.get(match.ingredientId);
        if (base) {
          severity = base.severity;
          sourceCitation = base.sourceCitation;
        }
        // Apply profile override if any
        const overridden = overrideMap.get(match.ingredientId);
        if (overridden) {
          severity = overridden;
        }
        flagged = severity !== 'watch';
      }

      findings.push({
        id: 0, // placeholder, Prisma will generate
        classificationResultId: 0, // placeholder
        ingredientId: match.ingredientId,
        raw: match.raw,
        recognized: match.recognized,
        severity,
        sourceCitation,
        flagged,
      } as ClassificationFinding);
    }

    const confidence = product.ingredientEntries.length
      ? recognizedCount / product.ingredientEntries.length
      : 0;

    const disclaimer = 'Classification provided for informational purposes only.';

    const savedResult = await this.repo.createClassificationResult({
      productId,
      methodologyVersionId: activeMethodology.id,
      confidence,
      disclaimer,
      findings,
    });

    // Shape output (strip DB-specific fields)
    return {
      productId,
      methodologyVersion: activeMethodology.version,
      confidence,
      disclaimer,
      findings: savedResult.findings.map(f => ({
        ingredientId: f.ingredientId,
        raw: f.raw,
        recognized: f.recognized,
        severity: f.severity,
        sourceCitation: f.sourceCitation,
        flagged: f.flagged,
      })),
    };
  }

  // Publishing new methodology version (idempotent re-scoring)
  async publishNewMethodologyVersion(version: string, rules: {
    ingredientId: number;
    severity: Severity;
    sourceCitation: string;
  }[]) {
    const existing = await this.repo.findMethodologyByVersion(version);
    if (existing) {
      // version already exists, nothing to do
      return existing;
    }
    const newVersion = await this.repo.createMethodologyVersion(version);
    await this.repo.createRules(newVersion.id, rules);

    // Re-score all products for this new version
    const products = await this.repo.getAllProducts();
    for (const p of products) {
      // idempotent: check if result already exists
      const existingResult = await this.repo.findClassificationResult(p.id, newVersion.id);
      if (!existingResult) {
        await this.classify(p.id);
      }
    }
    return newVersion;
  }
}
