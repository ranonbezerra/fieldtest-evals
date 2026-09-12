import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationController } from '../src/classification/classification.controller.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import type { ClassificationResponse } from '../src/classification/classification.service.js';
import { ApiEnvelopeFilter, ProductNotFoundError } from '../src/common/api-error.filter.js';
import {
  buildService,
  CHILD_PROFILE,
  NIGHT_CREAM,
  PEELING_GEL,
  PREGNANCY_PROFILE,
  SHUFFLED_NIGHT_CREAM,
  V1,
} from './fixtures.js';

describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = buildService().service;
  });

  it('resolves case variants, accents, double spaces and OCR typos through synonyms', async () => {
    const peeling = await service.classify(PEELING_GEL);
    expect(peeling.ingredients.find((finding) => finding.input === 'Salixylic Acid')).toMatchObject({
      resolved: 'Salicylic acid',
      status: 'flagged',
      severity: 'watch',
      source: 'Curated watch list, 2024-01',
    });
    expect(peeling.ingredients.find((finding) => finding.input === 'T0COPHEROL')).toMatchObject({
      resolved: 'Tocopherol',
      status: 'clear',
    });
    expect(peeling.unknowns).toEqual([]);
    expect(peeling.confidence).toBe(1);

    const { id } = await service.createProduct('Accent cream', ['Caféine', 'Retinyl  Palmitate', 'bha', 'WATER']);
    const result = await service.classify(id);
    expect(result.ingredients.find((finding) => finding.input === 'Caféine')).toMatchObject({
      resolved: 'Caffeine',
      status: 'clear',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Retinyl  Palmitate')).toMatchObject({
      resolved: 'Retinyl palmitate',
      status: 'flagged',
      severity: 'watch',
    });
    expect(result.ingredients.find((finding) => finding.input === 'bha')).toMatchObject({
      resolved: 'Salicylic acid',
      status: 'flagged',
    });
    expect(result.ingredients.find((finding) => finding.input === 'WATER')).toMatchObject({
      resolved: 'Aqua',
      status: 'clear',
    });
    expect(result.confidence).toBe(1);
  });

  it('flags ingredients from the active methodology with severity and source citation', async () => {
    const { id } = await service.createProduct('Cream', ['Aqua', 'Retinyl palmitate', 'Benzoyl peroxide', 'Tocopherol']);
    const result = await service.classify(id);

    expect(result.ingredients.find((finding) => finding.input === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged',
      flagged: true,
      severity: 'watch',
      source: 'Curated watch list, 2024-01',
      origin: 'base',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Benzoyl peroxide')).toMatchObject({
      status: 'flagged',
      severity: 'restricted',
      source: 'EU Reg 1223/2009, Annex III, 315-1',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Aqua')).toMatchObject({
      status: 'clear',
      flagged: false,
      severity: null,
      source: null,
    });
    expect(result.summary).toEqual({ watch: 1, restricted: 1, banned: 0 });
    expect(result.disclaimer).toContain('Informational');
    // No binary verdict fields anywhere in the payload.
    expect(result).not.toHaveProperty('safe');
    expect(result).not.toHaveProperty('toxic');
  });

  it('lists unknown ingredients and lowers confidence proportionally', async () => {
    const result = await service.classify(NIGHT_CREAM);

    expect(result.ingredients.find((finding) => finding.input === 'Mystery Butter X')).toMatchObject({
      status: 'unknown',
      resolved: null,
      flagged: false,
      severity: null,
    });
    expect(result.unknowns).toEqual(['mystery butter x']);
    expect(result.confidence).toBe(0.8333); // 5 of the 6 listed ingredients resolved

    const { id } = await service.createProduct('Known only', ['Aqua', 'Tocopherol']);
    const known = await service.classify(id);
    expect(known.confidence).toBe(1);
    expect(result.confidence).toBeLessThan(known.confidence);
  });

  it('profile modifiers tighten findings: introduce new flags and escalate severities', async () => {
    const base = await service.classify(NIGHT_CREAM);
    expect(base.ingredients.find((finding) => finding.resolved === 'Limonene')).toMatchObject({
      status: 'clear',
      flagged: false,
      origin: 'base',
    });

    const child = await service.classify(NIGHT_CREAM, CHILD_PROFILE);
    expect(child.profile).toEqual({ id: CHILD_PROFILE, name: 'child_under_3' });
    expect(child.ingredients.find((finding) => finding.resolved === 'Limonene')).toMatchObject({
      status: 'flagged',
      flagged: true,
      severity: 'restricted',
      origin: 'profile_modifier',
      source: 'AAP position paper, 2023',
      base_severity: null,
    });

    const pregnancy = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    expect(pregnancy.ingredients.find((finding) => finding.resolved === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged',
      severity: 'banned',
      base_severity: 'watch',
      base_source: 'Curated watch list, 2024-01',
      source: 'FDA 2023 advisory on retinoids',
      origin: 'profile_modifier',
    });

    // Confidence is unaffected by the profile; only flags change.
    expect(pregnancy.confidence).toBe(base.confidence);
    expect(pregnancy.summary).toEqual({ watch: 0, restricted: 0, banned: 1 });
  });

  it('rejects an unknown profile without side effects', async () => {
    await expect(service.classify(NIGHT_CREAM, 'no-such-profile')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
    expect(await service.listStoredResults(NIGHT_CREAM)).toHaveLength(0);
  });

  it('rejects classification when no methodology version is active', async () => {
    const inactive = buildService({ withActiveVersion: false }).service;
    await expect(inactive.classify(NIGHT_CREAM)).rejects.toMatchObject({ code: 'no_active_methodology' });
  });

  it('rejects a missing product', async () => {
    await expect(service.classify('no-such-product')).rejects.toMatchObject({ code: 'product_not_found' });
  });

  it('is identical across reruns and across shuffled ingredient order', async () => {
    const first = await service.classify(NIGHT_CREAM);
    const second = await service.classify(NIGHT_CREAM);
    expect(second).toEqual(first);

    const shuffled = await service.classify(SHUFFLED_NIGHT_CREAM);
    expect(shuffled.ingredients).toEqual(first.ingredients);
    expect(shuffled.unknowns).toEqual(first.unknowns);
    expect(shuffled.confidence).toBe(first.confidence);
    expect(shuffled.summary).toEqual(first.summary);

    // The stored result is deterministic as well.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).toEqual(first);
  });

  it('stores the profile-independent base result under (product, version)', async () => {
    const withProfile = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    const withoutProfile = await service.classify(NIGHT_CREAM);

    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    const payload = stored[0].payload as ClassificationResponse;
    expect(payload).toEqual(withoutProfile);
    expect(payload.profile).toBeNull();
    expect(withProfile.profile).toEqual({ id: PREGNANCY_PROFILE, name: 'pregnancy' });
  });

  it('publishing a new version rescans all products idempotently and keeps previous results', async () => {
    const before = await service.classify(NIGHT_CREAM);
    expect(before.methodology_version).toBe('2024.1');
    expect(before.ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe('clear');

    const published = await service.publishVersion({
      code: '2024.2',
      rules: [
        { ingredient: 'Limonene', severity: 'watch', source: 'Curated watch list, 2024-02' },
        { ingredient: 'Retinyl palmitate', severity: 'restricted', source: 'Curated watch list, 2024-02' },
      ],
    });
    expect(published).toMatchObject({
      code: '2024.2',
      status: 'active',
      published: true,
      rescanned_products: 3,
    });

    const after = await service.classify(NIGHT_CREAM);
    expect(after.methodology_version).toBe('2024.2');
    expect(after.ingredients.find((finding) => finding.resolved === 'Limonene')?.severity).toBe('watch');
    expect(after.ingredients.find((finding) => finding.resolved === 'Retinyl palmitate')?.severity).toBe(
      'restricted',
    );

    // Idempotent re-scoring: repeating it adds nothing and changes nothing.
    expect(await service.rescoreVersion(published.id)).toBe(3);
    expect(await service.rescoreVersion(published.id)).toBe(3);

    // Both versions' results coexist and stay retrievable.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored.map((row) => row.methodologyVersionCode).sort()).toEqual(['2024.1', '2024.2']);
    const v1 = stored.find((row) => row.methodologyVersionCode === '2024.1')!;
    const v2 = stored.find((row) => row.methodologyVersionCode === '2024.2')!;
    expect((v1.payload as ClassificationResponse).ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe(
      'clear',
    );
    expect((v2.payload as ClassificationResponse).ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe(
      'flagged',
    );

    const onlyV1 = await service.listStoredResults(NIGHT_CREAM, V1);
    expect(onlyV1).toHaveLength(1);
    expect(onlyV1[0].methodologyVersionCode).toBe('2024.1');
  });

  it('rejects duplicate version codes and rules with unknown ingredients', async () => {
    await expect(service.publishVersion({ code: '2024.1', rules: [] })).rejects.toMatchObject({
      code: 'methodology_version_exists',
    });
    await expect(
      service.publishVersion({
        code: '2024.2',
        rules: [{ ingredient: 'Unobtainium', severity: 'watch', source: 'S' }],
      }),
    ).rejects.toMatchObject({
      code: 'unknown_ingredient_in_rule',
      details: { ingredients: ['Unobtainium'] },
    });
    // A failed publish leaves the active methodology untouched.
    expect((await service.classify(NIGHT_CREAM)).methodology_version).toBe('2024.1');
  });
});

describe('ClassificationController', () => {
  function buildController() {
    const calls: Record<string, unknown> = {};
    const serviceStub = {
      createProduct: async (name: string, ingredients: string[]) => {
        calls.createProduct = [name, ingredients];
        return { id: 'p-new', name };
      },
      classify: async (productId: string, profileId?: string) => {
        calls.classify = [productId, profileId];
        return { product_id: productId };
      },
      publishVersion: async (input: { code: string; rules: unknown[] }) => {
        calls.publishVersion = input;
        return { code: input.code };
      },
      listStoredResults: async (productId: string, versionId?: string) => {
        calls.listStoredResults = [productId, versionId];
        return [];
      },
    };
    const controller = new ClassificationController(serviceStub as unknown as ClassificationService);
    return { controller, calls };
  }

  it('forwards valid bodies to the service', async () => {
    const { controller, calls } = buildController();

    await controller.createProduct({ name: 'Cream', ingredients: ['Aqua', 'Limonene'] });
    expect(calls.createProduct).toEqual(['Cream', ['Aqua', 'Limonene']]);

    await controller.classify({ product_id: 'p1', profile_id: 'pf1' });
    expect(calls.classify).toEqual(['p1', 'pf1']);

    await controller.classify({ product_id: 'p1' });
    expect(calls.classify).toEqual(['p1', undefined]);

    await controller.publishMethodologyVersion({
      code: '2025.1',
      rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }],
    });
    expect(calls.publishVersion).toEqual({
      code: '2025.1',
      rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }],
    });

    await controller.listClassifications('p1', 'v1');
    expect(calls.listStoredResults).toEqual(['p1', 'v1']);
  });

  it('rejects invalid input with envelope error codes', async () => {
    const { controller } = buildController();

    await expect(controller.createProduct('oops')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.createProduct({ name: '', ingredients: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.createProduct({ name: 'X', ingredients: ['ok', ''] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.classify({ product_id: 7 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: 'p1', profile_id: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.listClassifications('', undefined)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      controller.publishMethodologyVersion({
        code: 'c',
        rules: [{ ingredient: 'Limonene', severity: 'meh', source: 's' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_severity' });
    await expect(
      controller.publishMethodologyVersion({
        code: 'c',
        rules: [{ ingredient: 'Limonene', severity: 'watch' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('ApiEnvelopeFilter', () => {
  function fakeHost() {
    const state: { status: number; body: unknown } = { status: 0, body: undefined };
    const response = {
      status(code: number) {
        state.status = code;
        return {
          json(body: unknown) {
            state.body = body;
          },
        };
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    return { state, host };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders ApiError as the documented envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new ProductNotFoundError('p-404'), host);
    expect(state.status).toBe(404);
    expect(state.body).toEqual({
      error: { code: 'product_not_found', message: expect.any(String), details: { product_id: 'p-404' } },
    });
  });

  it('renders foreign HttpExceptions with the same envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new HttpException('Invalid JSON', HttpStatus.BAD_REQUEST), host);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { code: 'http_error', message: 'Invalid JSON' } });
  });

  it('falls back to internal_error for unexpected exceptions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new Error('boom'), host);
    expect(state.status).toBe(500);
    expect(state.body).toEqual({
      error: { code: 'internal_error', message: expect.any(String), details: {} },
    });
  });
});
