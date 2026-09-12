import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { ProductRepository } from '../product/product.repository.js';
import { MethodologyRepository } from '../methodology/methodology.repository.js';
import { ProfileRepository } from '../profile/profile.repository.js';
import { ClassificationRepository } from './classification.repository.js';

export type Severity = 'BANNED' | 'RESTRICTED' | 'WATCH';
export type OutputSeverity = 'banned' | 'restricted' | 'watch' | null;

export interface Finding {
  ingredient: string;
  raw: string;
  resolved: boolean;
  flagged: boolean;
  severity: OutputSeverity;
  sourceCitation: string | null;
  appliedBy: 'base' | 'profile' | null;
  note: string | null;
}

export interface ClassificationResultDto {
  productId: string;
  methodologyVersionId: string;
  methodologyVersion: number;
  profileId: string | null;
  profileName: string | null;
  findings: Finding[];
  unknownIngredients: string[];
  confidence: number;
  disclaimer: string;
}

export interface PublishResultDto {
  publishedVersionId: string;
  publishedVersion: number;
  rescoredProducts: number;
  rescoredResults: number;
}

interface ResolvedIngredient {
  raw: string;
  normalized: string;
  resolved: boolean;
  ingredientId: string | null;
  canonicalName: string | null;
}

interface BaseRule {
  severity: Severity;
  sourceCitation: string;
}

interface ProfileModifier {
  severity: Severity;
  sourceCitation: string;
}

interface ChosenRule {
  severity: Severity;
  sourceCitation: string;
  appliedBy: 'base' | 'profile';
}

const DISCLAIMER =
  'This output is a rule-based screening aid only. It is not a binary safe/toxic verdict, medical advice, or a guarantee of safety.';

// ASSUMPTION: The task references provided OCR synonym fixtures without supplying them; this built-in map is the minimal stand-in.
const OCR_TYPO_FIXTURES: Record<string, string> = {
  avobenzon: 'avobenzone',
  oxybenzon: 'oxybenzone',
  fragrans: 'fragrance',
  parfume: 'parfum',
  cologn: 'cologne',
};

const SEVERITY_RANK: Record<Severity, number> = {
  BANNED: 3,
  RESTRICTED: 2,
  WATCH: 1,
};

@Injectable()
export class ClassificationService {
  constructor(
    private readonly ingredients: IngredientRepository,
    private readonly products: ProductRepository,
    private readonly methodologies: MethodologyRepository,
    private readonly profiles: ProfileRepository,
    private readonly classifications: ClassificationRepository,
  ) {}

  async classify(productId: string, profileId?: string): Promise<ClassificationResultDto> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new AppException(404, 'resource_not_found', `Product ${productId} was not found.`, { productId });
    }

    const active = await this.methodologies.findActive();
    if (!active) {
      throw new AppException(409, 'no_active_methodology', 'No methodology version is active.', {});
    }

    const normalizedProfileId = profileId && profileId.length > 0 ? profileId : undefined;
    let profile: { id: string; name: string } | null = null;
    const profileModifiers = new Map<string, ProfileModifier>();

    if (normalizedProfileId) {
      const foundProfile = await this.profiles.findById(normalizedProfileId);
      if (!foundProfile) {
        throw new AppException(
          404,
          'resource_not_found',
          `Family profile ${normalizedProfileId} was not found.`,
          { profileId: normalizedProfileId },
        );
      }

      profile = foundProfile;
      const modifierRows = await this.profiles.findModifiers(normalizedProfileId);
      for (const modifier of modifierRows) {
        profileModifiers.set(modifier.ingredientId, {
          severity: modifier.severity as Severity,
          sourceCitation: modifier.sourceCitation,
        });
      }
    }

    const baseRules = new Map<string, BaseRule>();
    for (const rule of active.rules) {
      baseRules.set(rule.ingredientId, {
        severity: rule.severity as Severity,
        sourceCitation: rule.sourceCitation,
      });
    }

    const resolutions = await this.resolveProductIngredients(product.ingredients ?? []);
    const findings: Finding[] = [];
    const unknownIngredients: string[] = [];

    for (const resolution of resolutions) {
      if (!resolution.resolved) {
        unknownIngredients.push(resolution.normalized);
        continue;
      }

      const base = baseRules.get(resolution.ingredientId as string);
      const modifier = profileModifiers.get(resolution.ingredientId as string);
      const chosen = this.chooseSeverity(base, modifier);

      findings.push({
        ingredient: resolution.canonicalName as string,
        raw: resolution.raw,
        resolved: true,
        flagged: chosen !== null,
        severity: chosen ? (chosen.severity.toLowerCase() as OutputSeverity) : null,
        sourceCitation: chosen ? chosen.sourceCitation : null,
        appliedBy: chosen ? chosen.appliedBy : null,
        note: chosen ? null : 'No active rule matched this ingredient.',
      });
    }

    unknownIngredients.sort((a, b) => a.localeCompare(b));
    const total = resolutions.length;
    const known = total - unknownIngredients.length;
    const confidence = total === 0 ? 1 : Math.round((known / total) * 10000) / 10000;

    const result: ClassificationResultDto = {
      productId,
      methodologyVersionId: active.id,
      methodologyVersion: active.version,
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? null,
      findings,
      unknownIngredients,
      confidence,
      disclaimer: DISCLAIMER,
    };

    await this.classifications.upsert({
      productId,
      methodologyVersionId: active.id,
      profileId: profile?.id ?? null,
      payload: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId?: string,
  ): Promise<ClassificationResultDto> {
    const normalizedProfileId = profileId && profileId.length > 0 ? profileId : null;
    const stored = await this.classifications.findByProductAndVersion(
      productId,
      methodologyVersionId,
      normalizedProfileId,
    );

    if (!stored) {
      throw new AppException(404, 'resource_not_found', 'Stored classification was not found.', {
        productId,
        methodologyVersionId,
        profileId: normalizedProfileId,
      });
    }

    return stored.payload as unknown as ClassificationResultDto;
  }

  async publishMethodologyVersion(versionId: string): Promise<PublishResultDto> {
    const version = await this.methodologies.findById(versionId);
    if (!version) {
      throw new AppException(
        404,
        'resource_not_found',
        `Methodology version ${versionId} was not found.`,
        { versionId },
      );
    }

    await this.methodologies.activate(versionId);

    const products = await this.products.findAllWithIngredients();
    const profiles = await this.profiles.findAll();
    const profileIds: Array<string | undefined> = [undefined, ...profiles.map((profile) => profile.id)];

    let rescoredResults = 0;
    for (const product of products) {
      for (const profileId of profileIds) {
        await this.classify(product.id, profileId);
        rescoredResults += 1;
      }
    }

    return {
      publishedVersionId: version.id,
      publishedVersion: version.version,
      rescoredProducts: products.length,
      rescoredResults,
    };
  }

  private normalizeInci(raw: string): string {
    let normalized = raw.trim().toLowerCase();
    normalized = normalized.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    normalized = normalized.replace(/[^a-z0-9\s-]/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return OCR_TYPO_FIXTURES[normalized] ?? normalized;
  }

  private async resolveOne(raw: string): Promise<ResolvedIngredient> {
    const normalized = this.normalizeInci(raw);

    const byName = await this.ingredients.findByNormalizedName(normalized);
    if (byName) {
      return {
        raw,
        normalized,
        resolved: true,
        ingredientId: byName.id,
        canonicalName: byName.name,
      };
    }

    const bySynonym = await this.ingredients.findByNormalizedSynonym(normalized);
    if (bySynonym) {
      return {
        raw,
        normalized,
        resolved: true,
        ingredientId: bySynonym.id,
        canonicalName: bySynonym.name,
      };
    }

    return {
      raw,
      normalized,
      resolved: false,
      ingredientId: null,
      canonicalName: null,
    };
  }

  private async resolveProductIngredients(
    productIngredients: Array<{ rawIngredient: string }>,
  ): Promise<ResolvedIngredient[]> {
    const resolved = await Promise.all(productIngredients.map((item) => this.resolveOne(item.rawIngredient)));
    const groups = new Map<string, { resolution: ResolvedIngredient; raws: Set<string> }>();

    for (const item of resolved) {
      const key = item.resolved ? `ingredient:${item.ingredientId}` : `unknown:${item.normalized}`;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, { resolution: item, raws: new Set([item.raw]) });
      } else {
        existing.raws.add(item.raw);
      }
    }

    const unique: ResolvedIngredient[] = [];
    for (const group of groups.values()) {
      const raw = [...group.raws].sort((a, b) => a.localeCompare(b))[0];
      unique.push({ ...group.resolution, raw });
    }

    return unique.sort((a, b) => {
      const aName = a.canonicalName ?? a.normalized;
      const bName = b.canonicalName ?? b.normalized;
      return aName.localeCompare(bName) || a.raw.localeCompare(b.raw);
    });
  }

  private chooseSeverity(base: BaseRule | undefined, modifier: ProfileModifier | undefined): ChosenRule | null {
    if (!base && !modifier) {
      return null;
    }

    if (base && modifier) {
      const baseRank = SEVERITY_RANK[base.severity] ?? 0;
      const modifierRank = SEVERITY_RANK[modifier.severity] ?? 0;

      if (modifierRank >= baseRank) {
        return {
          severity: modifier.severity,
          sourceCitation: modifier.sourceCitation,
          appliedBy: 'profile',
        };
      }

      return {
        severity: base.severity,
        sourceCitation: base.sourceCitation,
        appliedBy: 'base',
      };
    }

    if (base) {
      return {
        severity: base.severity,
        sourceCitation: base.sourceCitation,
        appliedBy: 'base',
      };
    }

    return {
      severity: modifier!.severity,
      sourceCitation: modifier!.sourceCitation,
      appliedBy: 'profile',
    };
  }
}
