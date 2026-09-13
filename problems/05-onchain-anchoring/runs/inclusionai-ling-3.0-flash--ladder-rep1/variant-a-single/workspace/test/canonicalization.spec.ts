import { canonicalHash } from '../src/canonicalization/canonicalization.js';

describe('canonicalHash', () => {
  test('deterministic: identical input produces identical hash', () => {
    const content = { patientId: 'abc', vitalSigns: { hr: 72, bp: '120/80' }, timestamp: '2024-01-01' };
    expect(canonicalHash(content)).toBe(canonicalHash(content));
  });

  test('key ordering: different key order produces same hash', () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('nested key ordering: deep key sort', () => {
    const a = { z: { y: 1, x: 2 }, a: { c: 3, b: 4 } };
    const b = { a: { b: 4, c: 3 }, z: { x: 2, y: 1 } };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('whitespace: compact vs pretty-printed same hash', () => {
    const obj: Record<string, unknown> = { name: 'test', values: [1, 2, 3] };
    obj.values = [1, 2, 3];
    const pretty = JSON.parse(JSON.stringify(obj, null, 2));
    expect(canonicalHash(obj)).toBe(canonicalHash(pretty));
  });

  test('number formatting: trailing zeros do not matter', () => {
    const a = { value: 72.0 };
    const b = { value: 72 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('array order is preserved', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [3, 2, 1] };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  test('null and boolean handling', () => {
    const a = { active: true, deleted: false, data: null };
    const b = { active: true, deleted: false, data: null };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  test('same logical document with different JSON key order produces same hash', () => {
    const content = {
      diagnosis: 'hypertension',
      patientId: 'P-001',
      encounter: {
        date: '2024-06-15',
        providerId: 'DOC-42',
      },
      medications: ['lisinopril', 'hctz'],
    };
    const reSerialized = {
      patientId: 'P-001',
      diagnosis: 'hypertension',
      encounter: { providerId: 'DOC-42', date: '2024-06-15' },
      medications: ['lisinopril', 'hctz'],
    };
    expect(canonicalHash(content)).toBe(canonicalHash(reSerialized));
  });
});
