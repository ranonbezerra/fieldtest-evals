import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.familyProfile.findUnique({
      where: { id },
    });
  }

  async findAll() {
    return this.prisma.familyProfile.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findModifiers(profileId: string) {
    return this.prisma.profileRuleModifier.findMany({
      where: { profileId },
      include: { ingredient: true },
      orderBy: { ingredientId: 'asc' },
    });
  }
}
