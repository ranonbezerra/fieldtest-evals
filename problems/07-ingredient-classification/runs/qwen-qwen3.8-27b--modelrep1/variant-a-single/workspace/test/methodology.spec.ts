import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../src/common/api-exception.js';
import { createWorld } from './helpers/world.js';

describe('methodology', () => {
  it('publishing rescors affected products and keeps previous versions retrievable', async () => {
    const world = await createWorld();
    const serum = world.productIds['Anti-Aging Serum'];
    const cream = world.productIds['Moisturizing Cream'];

    const published = await world.methodology.publish(world.versionIds[2]);
    expect(published.rescoredProducts).toBe(2);
    expect(published.version.isActive).toBe(true);
    expect(published.version.status).toBe('active');

    const underV1 = await world.classification.getStored(serum, world.versionIds[1]);
    const underV2 = await world.classification.getStored(serum, world.versionIds[2]);
    expect(underV1.methodologyVersion).toBe(1);
    expect(underV2.methodologyVersion).toBe(2);

    // The version delta is visible: the typo-listed BHA is clear under v1
    // and restricted under v2.
    const salicylicV1 = underV1.findings.find((finding) => finding.listedName === 'Silicylic Acid');
    const salicylicV2 = underV2.findings.find((finding) => finding.listedName === 'Silicylic Acid');
    expect(salicylicV1?.status).toBe('clear');
    expect(salicylicV2?.status).toBe('flagged');
    expect(salicylicV2?.severity).toBe('restricted');

    // The other product was rescored under the new version as well.
    const creamV2 = await world.classification.getStored(cream, world.versionIds[2]);
    expect(creamV2.methodologyVersion).toBe(2);
    expect(creamV2.confidence).toBe(80);

    // Live classification now follows the newly published version.
    const live = await world.classification.classify(serum);
    expect(live.methodologyVersion).toBe(2);

    // The earlier version was superseded but remains retrievable.
    const v1Summary = await world.methodologyRepo.findVersion(world.versionIds[1]);
    expect(v1Summary?.isActive).toBe(false);
    expect(v1Summary?.status).toBe('superseded');
    expect((await world.classification.getStored(serum, world.versionIds[1])).findings).toEqual(underV1.findings);
  });

  it('rescoring is idempotent across repeated publishes', async () => {
    const world = await createWorld();
    const cream = world.productIds['Moisturizing Cream'];

    const first = await world.methodology.publish(world.versionIds[2]);
    const snapshot = await world.classification.getStored(cream, world.versionIds[2]);
    const second = await world.methodology.publish(world.versionIds[2]);

    expect(second.rescoredProducts).toBe(first.rescoredProducts);
    const after = await world.classification.getStored(cream, world.versionIds[2]);
    expect(after.findings).toEqual(snapshot.findings);
    expect(after.unknowns).toEqual(snapshot.unknowns);
    expect(after.confidence).toBe(snapshot.confidence);
    expect(after.disclaimer).toBe(snapshot.disclaimer);
    // One stored row per (product, version): 2 products x 2 versions.
    expect(world.classificationRepo.resultCount()).toBe(4);
  });

  it('refuses to create a version that references an unknown ingredient', async () => {
    const world = await createWorld();
    const error = await world.methodology
      .create({
        version: 9,
        name: 'Broken version',
        rules: [{ ingredient: 'not-an-ingredient', severity: 'watch', source: 'n/a' }],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe('unknown_ingredient');
    expect((error as ApiException).getStatus()).toBe(422);
  });

  it('refuses duplicate version numbers', async () => {
    const world = await createWorld();
    const error = await world.methodology
      .create({
        version: 1,
        name: 'Duplicate',
        rules: [{ ingredient: 'glycerin', severity: 'watch', source: 'n/a' }],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe('methodology_version_exists');
    expect((error as ApiException).getStatus()).toBe(409);
  });
});
