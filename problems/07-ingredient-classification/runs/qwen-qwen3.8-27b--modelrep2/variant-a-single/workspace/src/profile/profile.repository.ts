import { Injectable } from '@nestjs/common';
import type { Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ModifierInput {
  ingredientId: string;
  severity: Severity;
  citation: string;
}

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { name: string; description?: string; modifiers: ModifierInput[] }) {
    return this.prisma.profile.create({
      data: {
        name: input.name,
        description: input.description,
        modifiers: { create: input.modifiers.map((modifier) => ({ ...modifier })) },
      },
      include: { modifiers: { orderBy: { id: 'asc' } } },
    });
  }

  findById(id: string) {
    return this.prisma.profile.findUnique({
      where: { id },
      include: { modifiers: { orderBy: { id: 'asc' } } },
    });
  }

  list() {
    return this.prisma.profile.findMany({
      orderBy: { name: 'asc' },
      include: { modifiers: { orderBy: { id: 'asc' } } },
    });
  }
}
