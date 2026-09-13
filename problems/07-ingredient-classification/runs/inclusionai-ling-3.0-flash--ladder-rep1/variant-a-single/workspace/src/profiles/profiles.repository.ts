import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Profile, ProfileModifier } from '@prisma/client';

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string): Promise<Profile> {
    return this.prisma.profile.create({ data: { name } });
  }

  async getById(id: string): Promise<(Profile & { modifiers: ProfileModifier[] }) | null> {
    return this.prisma.profile.findFirst({
      where: { id },
      include: { modifiers: true },
    });
  }

  async addModifier(
    profileId: string,
    field: string,
    severity: string,
    description: string,
  ): Promise<ProfileModifier> {
    return this.prisma.profileModifier.create({
      data: { field, severity, description, profileId },
    });
  }
}
