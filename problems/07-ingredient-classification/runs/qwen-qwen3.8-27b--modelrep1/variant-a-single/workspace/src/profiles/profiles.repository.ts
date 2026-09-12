import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProfileRef, Severity } from '../classification/classification.types.js';

export interface PersistProfileInput {
  name: string;
  description: string | null;
  modifiers: { ingredientId: string; severity: Severity; source: string; note: string | null }[];
}

export interface IProfilesRepository {
  findByName(name: string): Promise<ProfileRef | null>;
  find(id: string): Promise<ProfileRef | null>;
  list(): Promise<ProfileRef[]>;
  create(input: PersistProfileInput): Promise<ProfileRef>;
  findIngredientByName(name: string): Promise<{ id: string; name: string } | null>;
}

@Injectable()
export class ProfilesRepository implements IProfilesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByName(name: string): Promise<ProfileRef | null> {
    const profile = await this.prisma.profile.findUnique({ where: { name }, include: { modifiers: true } });
    return profile ? toRef(profile) : null;
  }

  async find(id: string): Promise<ProfileRef | null> {
    const profile = await this.prisma.profile.findUnique({ where: { id }, include: { modifiers: true } });
    return profile ? toRef(profile) : null;
  }

  async list(): Promise<ProfileRef[]> {
    const profiles = await this.prisma.profile.findMany({ include: { modifiers: true } });
    return profiles.map(toRef);
  }

  async create(input: PersistProfileInput): Promise<ProfileRef> {
    const profile = await this.prisma.profile.create({
      data: {
        name: input.name,
        description: input.description,
        modifiers: {
          create: input.modifiers.map((modifier) => ({
            ingredientId: modifier.ingredientId,
            severity: modifier.severity,
            source: modifier.source,
            note: modifier.note,
          })),
        },
      },
      include: { modifiers: true },
    });
    return toRef(profile);
  }

  async findIngredientByName(name: string): Promise<{ id: string; name: string } | null> {
    const row = await this.prisma.ingredient.findUnique({ where: { name } });
    return row ? { id: row.id, name: row.name } : null;
  }
}

function toRef(profile: {
  id: string;
  name: string;
  description: string | null;
  modifiers: { ingredientId: string; severity: string; source: string; note: string | null }[];
}): ProfileRef {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    modifiers: profile.modifiers.map((modifier) => ({
      ingredientId: modifier.ingredientId,
      severity: modifier.severity as Severity,
      source: modifier.source,
      note: modifier.note,
    })),
  };
}
