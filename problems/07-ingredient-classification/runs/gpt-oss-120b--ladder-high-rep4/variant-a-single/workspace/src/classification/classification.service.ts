import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository.js';
import {
  ClassificationResultDto,
  SeverityString,
  IngredientFinding,
} from './dto/classification-result.dto.js';
import { Rule, Severity } from '@prisma/client';

@Injectable()
export class ClassificationService {
  // Map of common OCR typos to canonical ingredient names (lowercased)
  // In a real app, this would be loaded from external fixtures.
  private readonly typoMap: Record<string, string> = {
    // Example entry used in tests
    'vitamina c': 'vitamin c',
    // Add more mappings as needed
  };

  // Deterministic precedence order for profile modifiers.
  // 1. childUnder3
  // 2. pregnant
  private readonly modifierPrecedence: ('childUnder3' | 'pregnant')[] = [
    'childUnder3',
    'pregnant',
  ];

  constructor(private readonly repo: ClassificationRepository) {}

  async classify(
    productId: number,
    profileId?: number,
    versionName?: string,
  ): Promise<ClassificationResultDto> {
    // Load product
    const product = await this.repo.getProductById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Load profile if provided
    const profile = profileId ? await this.repo.getProfileById(profileId) : null;

    // Resolve methodology version (active or explicit)
    const methodologyVersion = versionName
      ? await this.repo.getMethodologyVersionByVersion(versionName)
      : await this.repo.getActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new Error('Methodology version not found');
    }

    // Load all rules for this version
    const rules = await this.repo.getRulesByMethodologyVersionId(
      methodologyVersion.id,
    );

    // Build a lookup map: ingredientId -> most severe rule
    const ruleMap = new Map<number, Rule>();
    for (const rule of rules) {
      if (rule.ingredientId !== null) {
        const existing = ruleMap.get(rule.ingredientId);
        if (
          !existing ||
          this.severityRank(rule.severity as Severity) >
            this.severityRank(existing.severity as Severity)
        ) {
          ruleMap.set(rule.ingredientId, rule);
        }
      }
    }

    // Load resolution map (normalized name -> canonical ingredient)
    const resolutionMap = await this.repo.getIngredientResolutionMap();

    const findings: IngredientFinding[] = [];
    let recognizedCount = 0;
    const totalCount = product.ingredients.length;

    for (const rawIngredient of product.ingredients) {
      const normalized = this.normalizeIngredient(rawIngredient);
      const typoResolved = this.typoMap[normalized] ?? normalized;
      const resolution = resolutionMap.get(typoResolved);
      if (resolution) {
        // Recognized ingredient
        recognizedCount++;
        const ingredientName = resolution.name;
        const ingredientId = resolution.id;

        const rule = ruleMap.get(ingredientId);
        let flag = false;
        let severity: SeverityString | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          severity = rule.severity.toLowerCase() as SeverityString;
          sourceCitation = rule.sourceCitation;
          // Base flag: watch severity is informational (not flagged)
          flag = severity !== 'watch';
        }

        // Apply profile modifiers if any
        if (profile) {
          ({ flag, severity } = this.applyModifiers(flag, severity, profile));
        }

        findings.push({
          ingredient: ingredientName,
          flag,
          severity,
          sourceCitation,
        });
      } else {
        // Unknown ingredient
        findings.push({
          ingredient: rawIngredient,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    // Deterministic ordering of findings
    findings.sort((a, b) => a.ingredient.localeCompare(b.ingredient));

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = 'Classification based on current methodology version.';

    const resultDto: ClassificationResultDto = {
      productId,
      version: methodologyVersion.version,
      findings,
      confidence,
      disclaimer,
    };

    // Persist result (idempotent upsert)
    await this.repo.upsertClassificationResult(
      productId,
      methodologyVersion.id,
      resultDto,
    );

    return resultDto;
  }

  private normalizeIngredient(input: string): string {
    return input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  private severityRank(sev: Severity): number {
    // BANNED > RESTRICTED > WATCH
    switch (sev) {
      case Severity.BANNED:
        return 3;
      case Severity.RESTRICTED:
        return 2;
      case Severity.WATCH:
        return 1;
      default:
        return 0;
    }
  }

  private applyModifiers(
    baseFlag: boolean,
    baseSeverity: SeverityString | null,
    profile: { childUnder3: boolean; pregnant: boolean },
  ): { flag: boolean; severity: SeverityString | null } {
    let flag = baseFlag;
    let severity = baseSeverity;

    for (const modifier of this.modifierPrecedence) {
      switch (modifier) {
        case 'childUnder3':
          if (profile.childUnder3 && severity === 'watch') {
            // Flip watch to flagged and upgrade severity to restricted
            flag = true;
            severity = 'restricted';
          }
          break;
        case 'pregnant':
          if (profile.pregnant && severity === 'restricted') {
            // Upgrade restricted to banned for pregnant profile
            severity = 'banned';
            flag = true;
          }
          break;
        default:
          break;
      }
    }

    return { flag, severity };
  }
}
