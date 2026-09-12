import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/users/users.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

function fakePrisma(users: Array<{ id: string; email: string }>): PrismaService {
  return {
    user: {
      async findUnique() {
        return users[0] ?? null;
      },
      async findMany() {
        return users;
      },
    },
  } as unknown as PrismaService;
}

describe('UsersService', () => {
  it('counts users', async () => {
    const svc = new UsersService(fakePrisma([{ id: 'u1', email: 'a@b.c' }]));
    expect(await svc.count()).toBe(1);
  });

  it('finds by email', async () => {
    const svc = new UsersService(fakePrisma([{ id: 'u1', email: 'a@b.c' }]));
    expect((await svc.findByEmail('a@b.c'))?.id).toBe('u1');
  });
});
