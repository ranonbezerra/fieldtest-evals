import { Injectable } from '@nestjs/common';
import { ClassifyRepository, ClassificationResultDto } from './classify.repository.js';
import { normalize, parseIngredients } from '../common/normalizer.js';
import { maxSeverity } from '../common/severity.js';
import {
  Synonym,
  Rule,
  ProfileModifier,
  MethodologyVersion,
} from '@prisma/client';

@Injectable()
export class ClassifyService {
  constructor(private readonly repository: ClassifyRepository) {}

  /**
   * Classify a product's ingredients.
   * @param productId - product to classify
   * @param profileId - optional profile for contextual modifiers
   * @param methodologyVersionId - optional specific version; defaults to active published version
   */
  async classify(
    productId: string,
    profileId?: string,
    methodologyVersionId?: string,
  ): Promise<ClassificationResultDto> {
    // 1. Resolve methodology version
    let versionId = methodologyVersionId;
    if (!versionId) {
      const version = await this.repository.getActiveVersion();
      versionId = version.id;
    }

    // 2. Idempotency check
    const existing = await this.repository.getResult(productId, versionId);
    if (existing) return existing;

    // 3. Fetch all data
    const product = await this.repository.getProduct(productId);
    const synonyms = await this.repository.getAllSynonyms();
    const rules = await this.repository.getRulesForVersion(versionId);
    let modifiers: ProfileModifier[] = [];
    if (profileId) {
      modifiers = await this.repository.getProfileModifiers(profileId);
    }
    const version = await this.repository.getVersion(versionId);

    // 4. Build lookup structures
    const { canonicalSet, synonymMap } = this.buildSynonymMaps(synonyms);
    const ruleMap = this.buildRuleMap(rules);

    // 5. Process each listed ingredient
    const listed = parseIngredients(product.ingredientList);
    const findings: ClassifyService.FindingOut[] = [];
    const unknown: string[] = [];
    let recognizedCount = 0;

    for (const item of listed) {
      const norm = normalize(item);
      const canonical = synonymMap.get(norm) ?? norm;
      const isKnown = canonicalSet.has(canonical);

      if (!isKnown) {
        unknown.push(item);
        continue;
      }

      recognizedCount++;
      const matchedRules: Rule[] = ruleMap.get(canonical) ?? [];

      let severity: string | undefined;
      let source: string | undefined;
      let flagged = false;

      // Apply base rules — most severe rule wins (deterministic)
      for (const r of matchedRules) {
        if (!severity || r.severity !== severity) {
          if (!severity || this.severityRank(r.severity) > this.severityRank(severity)) {
            severity = r.severity;
            source = r.source;
            flagged = true;
          }
        }
      }

      // Apply profile modifiers — most severe wins, deterministic precedence: max-severity
      for (const modifier of modifiers) {
        if (modifier.field === canonical) {
          if (!severity) {
            severity = modifier.severity;
            source = modifier.description;
            flagged = true;
          } else {
            severity = maxSeverity(severity, modifier.severity);
            flagged = true;
          }
        }
      }

      findings.push({
        ingredientName: canonical,
        listedAs: item,
        isFlagged: flagged,
        severity,
        source,
      });
    }

    // 6. Sort findings for order-independence
    findings.sort((a, b) =>
      a.ingredientName.localeCompare(b.ingredientName),
    );

    // 7. Confidence = recognised / total
    const confidence = listed.length > 0 ? recognizedCount / listed.length : 1.0;

    // 8. Disclaimer
    const disclaimer = `Classification based on methodology version ${version.version}.`;

    // 9. Store and return
    return this.repository.storeResult({
      productId,
      methodologyVersionId: versionId,
      confidence,
      disclaimer,
      findings: findings.map((f) => ({
        ingredientName: f.ingredientName,
        listedAs: f.listedAs,
        isFlagged: f.isFlagged,
        severity: f.severity,
        source: f.source,
      })),
      unknownIngredients: unknown,
    });
  }

  private buildSynonymMaps(
    synonyms: (Synonym & { ingredient: { name: string } })[],
  ): { canonicalSet: Set<string>; synonymMap: Map<string, string> } {
    const canonicalSet = new Set<string>();
    const synonymMap = new Map<string, string>();
    for (const s of synonyms) {
      canonicalSet.add(s.ingredient.name);
      const norm = normalize(s.text);
      if (!synonymMap.has(norm)) {
        synonymMap.set(norm, s.ingredient.name);
      }
    }
    return { canonicalSet, synonymMap };
  }

  private buildRuleMap(rules: Rule[]): Map<string, Rule[]> {
    const map = new Map<string, Rule[]>();
    for (const rule of rules) {
      if (!map.has(rule.name)) map.set(rule.name, []);
      map.get(rule.name)!.push(rule);
    }
    return map;
  }

  private severityRank(severity: string): number {
    return { watch: 1, restricted: 2, banned: 3 }[severity] ?? 0;
  }
}

export namespace ClassifyService {
  export interface FindingOut {
    ingredientName: string;
    listedAs: string;
    isFlagged: boolean;
    severity?: string;
    source?: string;
  }
}
