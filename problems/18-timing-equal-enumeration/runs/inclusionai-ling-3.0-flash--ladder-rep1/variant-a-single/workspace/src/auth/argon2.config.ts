export const ARGON2_CONFIG = {
  type: 'argon2id' as const,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export const DUMMY_PASSWORD = '__dummy_for_timing_equalization__';
