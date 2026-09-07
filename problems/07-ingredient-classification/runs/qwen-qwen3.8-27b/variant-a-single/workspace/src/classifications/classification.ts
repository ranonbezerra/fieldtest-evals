import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { ClassificationRepository } from './classification.repository.js';

// ASSUMPTION: The Prisma client has not been generated in this workspace, so
// `@prisma/client` does not yet export `PrismaClient`, `Prisma`, or a `Severity`
// enum. The `Severity` type is therefore defined locally here and re-exported
// for consumers (including `profile.service.ts`) that currently import it from
// `@prisma/client`. Once `prisma generate` runs, the local definition can be
// replaced by a re-export from the generated client.

export type Severity = 'banned' | 'restricted' | 'watch';
export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type MatchedBy = 'direct' | 'synonym' | 'typo' | null;

export interface IngredientFinding {
  ingredient: string;
  canonicalName: string | null;
  rawName: string;
  status: FindingStatus;
  severity: Severity | null;
  source: string | null;
  flag: string | null;
  matchedBy: MatchedBy;
}

export interface ClassificationResult {
  productId: string;
  methodologyVersion: string;
  findings: IngredientFinding[];
  confidence: number;
  disclaimer: string;
}

export const DISCLAIMER =
  'This result is informational only and does not constitute a safety determination. ' +
  'Ingredients flagged here may be subject to regulatory restrictions or family-specific ' +
  'concerns. Consult a qualified professional for personalized advice.';

/**
 * Core classification engine.
 *
 * Normalizes and resolves each ingredient in a product's INCI list (handling
 * case, accents, synonyms, and common OCR typos), applies the active
 * methodology's base rules, then overlays the optional profile's contextual
 * modifiers by defined precedence.
 *
 * Output is always a structured set of per-ingredient findings plus an
 * overall confidence score and a disclaimer — never a binary safe/toxic label.
 */
@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  /**
   * Classifies a product's ingredients under the active methodology version,
   * optionally tightening rules via a family profile.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResult> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) {
      throw Errors.notFound('Product', { productId });
    }

    const activeVersion = await this.repository.findActiveMethodology();
    if (!activeVersion) {
      throw Errors.invalidState('No active methodology version published.');
    }

    const rules = await this.repository.findRulesByVersion(activeVersion.id);
    const ruleMap = new Map<string, { severity: Severity; flag: string; source: string }>();
    for (const rule of rules) {
      ruleMap.set(rule.canonicalName, rule);
    }

    // Resolve profile modifiers (applied after base rules, tightening only).
    let profileModifiers: Map<string, { severity: Severity; flag: string; source: string }> | null = null;
    if (profileId) {
      const profile = await this.repository.findProfileWithModifiers(profileId);
      if (!profile) {
        throw Errors.notFound('Profile', { profileId });
      }
      profileModifiers = new Map(
        profile.modifiers.map((m) => [m.canonicalName, { severity: m.severity, flag: m.flag, source: m.source }]),
      );
    }

    const findings: IngredientFinding[] = product.ingredients.map((rawName: string) => {
      const resolved = this.resolveIngredient(rawName);

      if (!resolved) {
        return {
          ingredient: rawName,
          canonicalName: null,
          rawName,
          status: 'unknown' as const,
          severity: null,
          source: null,
          flag: null,
          matchedBy: null as const,
        };
      }

      // Base rule lookup.
      const baseRule = ruleMap.get(resolved.canonicalName);

      // Profile modifier overrides base rule (tightens only).
      let effective: { severity: Severity; flag: string; source: string } | null = baseRule;
      if (profileModifiers && profileModifiers.size > 0) {
        const modifier = profileModifiers.get(resolved.canonicalName);
        if (modifier) {
          // Precedence: profile modifier wins over base rule.
          effective = modifier;
        }
      }

      if (effective) {
        return {
          ingredient: resolved.canonicalName,
          canonicalName: resolved.canonicalName,
          rawName,
          status: 'flagged' as const,
          severity: effective.severity,
          source: effective.source,
          flag: effective.flag,
          matchedBy: resolved.matchedBy,
        };
      }

      return {
        ingredient: resolved.canonicalName,
        canonicalName: resolved.canonicalName,
        rawName,
        status: 'clear' as const,
        severity: null,
        source: null,
        flag: null,
        matchedBy: resolved.matchedBy,
      };
    });

    // Confidence: proportion of ingredients that were recognized.
    const recognized = findings.filter((f) => f.status !== 'unknown').length;
    const confidence = findings.length === 0 ? 1 : recognized / findings.length;

    return {
      productId,
      methodologyVersion: activeVersion.version,
      findings,
      confidence,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Resolves a raw ingredient name to its canonical form.
   * Returns null if no match is found after normalization and synonym/typo lookup.
   */
  private resolveIngredient(rawName: string): { canonicalName: string; matchedBy: MatchedBy } | null {
    const normalized = this.normalize(rawName);

    // Direct match on normalized canonical name.
    const direct = this.repository.findCanonicalByNormalized(normalized);
    if (direct) {
      return { canonicalName: direct, matchedBy: 'direct' as const };
    }

    // Synonym lookup.
    const synonym = this.repository.findCanonicalBySynonym(normalized);
    if (synonym) {
      return { canonicalName: synonym, matchedBy: 'synonym' as const };
    }

    // Fuzzy/typo lookup (Levenshtein distance ≤ 2 on normalized form).
    const typo = this.repository.findCanonicalByTypo(normalized);
    if (typo) {
      return { canonicalName: typo, matchedBy: 'typo' as const };
    }

    return null;
  }

  /**
   * Normalizes a name: lowercase, strip diacritics, collapse whitespace, trim.
   */
  private normalize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
