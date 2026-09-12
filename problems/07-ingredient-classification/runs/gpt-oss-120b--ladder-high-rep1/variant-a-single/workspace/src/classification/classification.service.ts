import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import { ProfileRepository } from '../profiles/profile.repository';
import { ClassificationResultDto, FindingDto } from './dto/classification-result.dto';
import { Severity } from '@prisma/client';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly classificationRepo: ClassificationRepository,
    private readonly profileRepo: ProfileRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
    methodologyVersionId?: number,
  ): Promise<ClassificationResultDto> {
    const product = await this.classificationRepo.findProductWithIngredients(productId);
    if (!product) {
      throw new NotFoundException(`Product with id ${productId} not found`);
    }

    const methodologyVersion = methodologyVersionId
      ? await this.classificationRepo.findMethodologyVersionById(methodologyVersionId)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('No active methodology version found');
    }

    const synonymMap = await this.classificationRepo.getSynonymMap(); // normalized synonym -> ingredientId
    const canonicalMap = await this.classificationRepo.getCanonicalIngredientMap(); // normalized name -> { id, name }

    const rulesMap = await this.classificationRepo.getRulesMapByVersion(methodologyVersion.id);

    const profile = profileId ? await this.profileRepo.findById(profileId) : null;
    if (profileId && !profile) {
      throw new NotFoundException(`Profile with id ${profileId} not found`);
    }

    const findings: FindingDto[] = [];
    let recognizedCount = 0;
    const totalCount = product.product_ingredients.length;

    for (const pi of product.product_ingredients) {
      const original = pi.ingredient_string;
      const normalized = normalizeIngredient(original);

      let ingredientId: number | null = null;
      let canonicalName: string | null = null;

      if (synonymMap.has(normalized)) {
        ingredientId = synonymMap.get(normalized)!;
        canonicalName = canonicalMap.get(normalized)?.name ?? null;
      } else if (canonicalMap.has(normalized)) {
        const entry = canonicalMap.get(normalized)!;
        ingredientId = entry.id;
        canonicalName = entry.name;
      }

      if (ingredientId) {
        recognizedCount++;
        const rule = rulesMap.get(ingredientId) ?? null;
        let flag = false;
        let severity: Severity | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          flag = true;
          severity = rule.severity;
          sourceCitation = rule.sourceCitation;
        }

        if (profile && severity) {
          severity = this.applyProfileModifier(severity, profile.type);
        }

        findings.push({
          original,
          canonical: canonicalName,
          flag,
          severity,
          sourceCitation,
          unknown: false,
        });
      } else {
        findings.push({
          original,
          canonical: null,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    // Deterministic ordering: sort findings by canonical name (or original) alphabetically
    findings.sort((a, b) => {
      const aKey = a.canonical?.toLowerCase() ?? a.original.toLowerCase();
      const bKey = b.canonical?.toLowerCase() ?? b.original.toLowerCase();
      return aKey.localeCompare(bKey);
    });

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = `Classification based on methodology version ${methodologyVersion.version}.`;

    await this.classificationRepo.upsertClassificationResult({
      productId: product.id,
      methodologyVersionId: methodologyVersion.id,
      confidence,
      disclaimer,
      findings,
    });

    return {
      productId: product.id,
      methodologyVersion: methodologyVersion.version,
      confidence,
      disclaimer,
      findings,
    };
  }

  async getResult(productId: number, version?: string): Promise<ClassificationResultDto> {
    const methodologyVersion = version
      ? await this.classificationRepo.findMethodologyVersionByName(version)
      : await this.classificationRepo.findActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new BadRequestException('Methodology version not found');
    }

    const result = await this.classificationRepo.findResult(productId, methodologyVersion.id);
    if (!result) {
      throw new NotFoundException(
        `Result for product ${productId} and version ${methodologyVersion.version} not found`,
      );
    }

    return {
      productId: result.productId,
      methodologyVersion: methodologyVersion.version,
      confidence: result.confidence,
      disclaimer: result.disclaimer,
      findings: result.findings as FindingDto[],
    };
  }

  /**
   * Apply profile modifiers to severity based on defined precedence.
   * Precedence: profile modifiers are applied after base rules and
   * elevate severity by one level (watch → restricted → banned).
   * If severity is already 'banned', it remains 'banned'.
   */
  private applyProfileModifier(severity: Severity, profileType: string): Severity {
    // For this implementation, all profile types share the same escalation logic.
    const order: Severity[] = ['watch', 'restricted', 'banned'];
    const idx = order.indexOf(severity);
    if (idx === -1) return severity;
    const newIdx = Math.min(idx + 1, order.length - 1);
    return order[newIdx];
  }
}
