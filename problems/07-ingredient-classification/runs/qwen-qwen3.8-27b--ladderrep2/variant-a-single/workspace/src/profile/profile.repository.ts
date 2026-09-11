import { Injectable, Inject } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewProfileModifier {
  ingredientId: string;
  severity: Severity;
  reason: string;
}

@Injectable()
export class ProfileRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(name: string, modifiers: NewProfileModifier[]) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.create({ data: { name } });
      if (modifiers.length > 0) {
        await tx.profileModifier.createMany({
          data: modifiers.map((modifier) => ({ ...modifier, profileId: profile.id })),
        });
      }
      return profile;
    });
  }

  list() {
    return this.prisma.profile.findMany({
      orderBy: { createdAt: 'asc' },
      include: { modifiers: true },
    });
  }

  findById(id: string) {
    return this.prisma.profile.findUnique({ where: { id }, include: { modifiers: true } });
  }
}
