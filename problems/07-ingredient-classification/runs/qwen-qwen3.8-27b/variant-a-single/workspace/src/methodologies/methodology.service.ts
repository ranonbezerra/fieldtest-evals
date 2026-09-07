import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { MethodologyRepository, StoredClassification, StoredFinding } from './methodology.repository.js';

/** Severity levels for ingredient findings. */
export type Severity = 'banned' | 'restricted' | 'watch';

/**
 * Standard disclaimer attached to every classification result.
 * No binary safe/toxic determination is ever made.
 */
export const DISCLAIMER =
  'This result is informational only and does not constitute a safety determination. ' +
  'Ingredients flagged here may be subject to regulatory restrictions or family-specific ' +
  'concerns. Consult a qualified professional for personalized advice.';

export interface RuleEntry {
  ingredientId: string;
  severity: Severity;
  flag: string;
  source: string;
}

/**
 * Manages immutable methodology versions and the publish workflow.
 * Publishing a new version activates it and triggers idempotent
 * re-scoring of all products so stored results reflect the new rules.
 * Results from prior versions remain retrievable.
 */
@Injectable()
export class MethodologyService {
  constructor(private readonly repository: MethodologyRepository) {}

  /** Returns the currently active version, or null if none is published. */
  async getActive(): Promise<{ id: string; version: string } | null> {
    return this.repository.findActive();
  }

  /** Retrieves a specific version by its version string. */
  async getVersion(version: string): Promise<{ id: string; version: string } | null> {
    const found = await this.repository.find(version);
    if (!found) {
      throw Errors.notFound('Methodology version', { version });
    }
    return found;
  }

  /**
   * Publishes a new immutable methodology version, activates it, and
   * triggers idempotent re-scoring of all affected products.
   * Re-publishing the same version string is idempotent.
   */
  async publish(version: string, rules: RuleEntry[]): Promise<string> {
    const existing = await this.repository.find(version);
    if (existing) {
      // Already published; just ensure it is active and re-score.
      await this.repository.setActive(existing.id);
      await this.rescoreAll();
      return existing.id;
    }
    const id = await this.repository.createVersion(version, rules);
    await this.repository.setActive(id);
    await this.rescoreAll();
    return id;
  }

  /**
   * Idempotent re-scoring: for every product, computes and stores a
   * base classification under the active version. Overwriting an
   * existing stored result for the same (product, version) pair is
   * safe and produces identical output.
   */
  async rescoreAll(): Promise<void> {
    const active = await this.repository.findActive();
    if (!active) return;

    const products = await this.repository.findProducts();
    const rules = await this.repository.findRules(active.id);
    const ruleMap = new Map<string, RuleEntry>();
    for (const rule of rules) {
      ruleMap.set(rule.ingredientId, rule);
    }

    for (const product of products) {
      const findings: StoredFinding[] = product.ingredients.map((rawName: string) => {
        const canonical = this.resolveIngredient(rawName);
        if (!canonical) {
          return {
            ingredient: rawName,
            status: 'unknown' as const,
            severity: null,
            flag: null,
            source: null,
          };
        }
        const rule = ruleMap.get(canonical);
        if (rule) {
          return {
            ingredient: canonical,
            status: 'flagged' as const,
            severity: rule.severity,
            flag: rule.flag,
            source: rule.source,
          };
        }
        return {
          ingredient: canonical,
          status: 'clear' as const,
          severity: null,
          flag: null,
          source: null,
        };
      });

      const recognized = findings.filter((f) => f.status !== 'unknown').length;
      const confidence = findings.length === 0 ? 1 : recognized / findings.length;

      await this.repository.upsertResult(product.id, active.id, {
        productId: product.id,
        methodologyVersionId: active.id,
        findings,
        confidence,
        disclaimer: DISCLAIMER,
      });
    }
  }

  /**
   * Resolves a raw ingredient name to its canonical form using
   * normalization (lowercase, strip accents) and synonym lookup.
   */
  private resolveIngredient(rawName: string): string | null {
    const normalized = this.normalize(rawName);
    const canonical = this.repository.findCanonicalByNormalized?.(normalized);
    // The repository handles synonym/typo resolution; if no match, return null.
    // This is a synchronous call in the current design; for async repos,
    // the caller would await.
    return canonical ?? null;
  }

  private normalize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
  }
}
