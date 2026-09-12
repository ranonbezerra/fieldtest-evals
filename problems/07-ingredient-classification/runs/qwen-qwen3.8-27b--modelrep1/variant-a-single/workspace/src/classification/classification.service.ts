import { Inject, Injectable } from '@nestjs/common';
import {
  BaseResult,
  ClassificationOutput,
  Finding,
  ModifierRef,
  ProductRecord,
  ProfileRef,
  ScoringContext,
  StoredClassificationResponse,
  normalizeIngredientName,
  severityRank,
} from './classification.types.js';
import { ApiException } from '../common/api-exception.js';
import { ClassificationRepository, type IClassificationRepository } from './classification.repository.js';

function disclaimerFor(versionName: string, version: number): string {
  return (
    `Automated screening against methodology "${versionName}" (version ${version}). ` +
    'Findings are advisory only: they are not a determination that a product is ' +
    'safe, unsafe, compliant or prohibited. Verify with a qualified professional before use.'
  );
}

@Injectable()
export class ClassificationService {
  constructor(@Inject(ClassificationRepository) private readonly repo: IClassificationRepository) {}

  /**
   * Classify a product against the active methodology, optionally under a
   * family profile. The stored row holds the base (no-profile) classification
   * keyed by (product, methodology version); profile modifiers are applied on
   * top at read time, so one stored result serves every profile.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const version = await this.repo.findActiveVersion();
    if (!version) {
      throw new ApiException('no_active_methodology', 'No methodology version is currently active; publish one first.', 409, {});
    }

    const context = await this.repo.loadScoringContext(version.id);
    if (!context) {
      throw new ApiException('resource_not_found', `Methodology version "${version.id}" not found.`, 404, {
        methodologyVersionId: version.id,
      });
    }

    const product = context.products.find((candidate) => candidate.id === productId);
    if (!product) {
      throw new ApiException('resource_not_found', `Product "${productId}" not found.`, 404, { productId });
    }

    // Compute the base result on demand if it has not been stored yet.
    let stored = await this.repo.findResult(productId, version.id);
    if (!stored) {
      stored = await this.repo.upsertResult({
        productId: product.id,
        methodologyVersionId: version.id,
        ...this.scoreBase(product, context),
      });
    }

    let profile: ProfileRef | null = null;
    if (profileId) {
      profile = await this.repo.findProfile(profileId);
      if (!profile) {
        throw new ApiException('resource_not_found', `Profile "${profileId}" not found.`, 404, { profileId });
      }
    }

    return {
      productId: product.id,
      productName: product.name,
      methodologyVersionId: version.id,
      methodologyVersion: version.version,
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? null,
      findings: profile ? this.applyProfile(stored.findings, profile, context.ingredientNameById) : stored.findings,
      unknowns: stored.unknowns,
      confidence: stored.confidence,
      disclaimer: stored.disclaimer,
      classifiedAt: stored.classifiedAt,
    };
  }

  /**
   * Read a stored classification for a (product, methodology version) pair.
   * The version may be any previously published version, not only the active
   * one, so results from older versions remain retrievable.
   */
  async getStored(productId: string, methodologyVersionId?: string): Promise<StoredClassificationResponse> {
    const version = methodologyVersionId
      ? await this.repo.findVersion(methodologyVersionId)
      : await this.repo.findActiveVersion();
    if (!version) {
      throw new ApiException(
        methodologyVersionId ? 'resource_not_found' : 'no_active_methodology',
        methodologyVersionId
          ? `Methodology version "${methodologyVersionId}" not found.`
          : 'No methodology version is currently active; publish one first.',
        methodologyVersionId ? 404 : 409,
        methodologyVersionId ? { methodologyVersionId } : {},
      );
    }

    const stored = await this.repo.findResult(productId, version.id);
    if (!stored) {
      throw new ApiException(
        'resource_not_found',
        `No stored classification for product "${productId}" under methodology version ${version.version}.`,
        404,
        { productId, methodologyVersionId: version.id },
      );
    }

    return {
      productId,
      methodologyVersionId: version.id,
      methodologyVersion: version.version,
      findings: stored.findings,
      unknowns: stored.unknowns,
      confidence: stored.confidence,
      disclaimer: stored.disclaimer,
      classifiedAt: stored.classifiedAt,
    };
  }

  /**
   * (Re)score every product under a methodology version. "Affected products"
   * means every product in the catalog; rescoring is idempotent, so running
   * this any number of times yields the same stored data.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const context = await this.repo.loadScoringContext(methodologyVersionId);
    if (!context) {
      throw new ApiException('resource_not_found', `Methodology version "${methodologyVersionId}" not found.`, 404, {
        methodologyVersionId,
      });
    }

    for (const product of context.products) {
      await this.repo.upsertResult({
        productId: product.id,
        methodologyVersionId: context.version.id,
        ...this.scoreBase(product, context),
      });
    }
    return context.products.length;
  }

  private scoreBase(product: ProductRecord, context: ScoringContext): BaseResult {
    const ruleByIngredient = new Map(context.rules.map((rule) => [rule.ingredientId, rule]));
    const findings: Finding[] = [];
    const unknowns: string[] = [];

    for (const listedName of product.listedIngredients) {
      const normalized = normalizeIngredientName(listedName);
      const ingredientId =
        context.synonymFormToIngredientId[normalized] ?? context.canonicalNameToIngredientId[normalized] ?? null;

      if (!ingredientId) {
        findings.push({
          listedName,
          canonicalName: null,
          status: 'unknown',
          flag: true,
          severity: null,
          source: null,
          note: 'Could not be matched to a known ingredient.',
        });
        unknowns.push(listedName);
        continue;
      }

      const rule = ruleByIngredient.get(ingredientId);
      const canonicalName = context.ingredientNameById[ingredientId] ?? null;
      if (rule) {
        findings.push({
          listedName,
          canonicalName,
          status: 'flagged',
          flag: true,
          severity: rule.severity,
          source: rule.source,
          note: rule.note,
        });
      } else {
        findings.push({
          listedName,
          canonicalName,
          status: 'clear',
          flag: false,
          severity: null,
          source: null,
          note: null,
        });
      }
    }

    // Sort so the output never depends on the order the list was stored in.
    findings.sort((a, b) => compareByNormalized(a.listedName, b.listedName));
    unknowns.sort(compareByNormalized);

    const total = findings.length;
    const resolved = total - unknowns.length;
    const confidence = total === 0 ? 100 : Math.round((resolved / total) * 10000) / 100;

    return {
      findings,
      unknowns,
      confidence,
      disclaimer: disclaimerFor(context.version.name, context.version.version),
    };
  }

  /**
   * Precedence: (1) the active methodology's base rule decides the finding;
   * (2) a profile modifier may only tighten it — escalate to a more severe
   * level, or flag an otherwise clear ingredient; (3) when a profile carries
   * several modifiers for one ingredient, the most severe wins. Modifiers
   * never clear a finding.
   */
  private applyProfile(findings: Finding[], profile: ProfileRef, nameById: Record<string, string>): Finding[] {
    const modifierByName = new Map<string, ModifierRef>();
    for (const modifier of profile.modifiers) {
      const name = nameById[modifier.ingredientId];
      if (!name) continue;
      const existing = modifierByName.get(name);
      if (!existing || severityRank(modifier.severity) > severityRank(existing.severity)) {
        modifierByName.set(name, modifier);
      }
    }

    return findings.map((finding) => {
      if (finding.status === 'unknown' || !finding.canonicalName) return finding;
      const modifier = modifierByName.get(finding.canonicalName);
      if (!modifier) return finding;

      if (finding.severity === null) {
        return {
          ...finding,
          status: 'flagged',
          flag: true,
          severity: modifier.severity,
          source: modifier.source,
          note: modifier.note ?? finding.note,
        };
      }
      if (severityRank(modifier.severity) > severityRank(finding.severity)) {
        return {
          ...finding,
          severity: modifier.severity,
          source: modifier.source,
          note: modifier.note ?? finding.note,
        };
      }
      return finding;
    });
  }
}

function compareByNormalized(a: string, b: string): number {
  const normalizedA = normalizeIngredientName(a);
  const normalizedB = normalizeIngredientName(b);
  if (normalizedA !== normalizedB) return normalizedA < normalizedB ? -1 : 1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}
