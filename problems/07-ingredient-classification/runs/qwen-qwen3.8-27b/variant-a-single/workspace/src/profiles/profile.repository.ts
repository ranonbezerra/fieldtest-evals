import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

// ASSUMPTION: The Prisma client has not been generated in this workspace, so
// model delegates are not typed on PrismaService. They are accessed via a
// local type assertion. Once `prisma generate` runs, the assertion can be
// removed.

export type Severity = 'banned' | 'restricted' | 'watch';

export interface ProfileModifierDto {
  id: string;
  profileId: string;
  canonicalName: string;
  severity: Severity;
  flag: string;
  source: string;
}

export interface ProfileWithModifiers {
  id: string;
  name: string;
  modifiers: ProfileModifierDto[];
}

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfileWithModifiers(profileId: string): Promise<ProfileWithModifiers | null> {
    const profile = await (this.prisma as unknown as {
      profile: {
        findUnique: (args: {
          where: { id: string };
          include: { modifiers: true };
        }) => Promise<{
          id: string;
          name: string;
          modifiers: Array<{
            id: string;
            profileId: string;
            canonicalName: string;
            severity: Severity;
            flag: string;
            source: string;
          }>;
        } | null>;
      };
    }).profile.findUnique({
      where: { id: profileId },
      include: { modifiers: true },
    });

    if (!profile) return null;

    return {
      id: profile.id,
      name: profile.name,
      modifiers: profile.modifiers.map((modifier) => ({
        id: modifier.id,
        profileId: modifier.profileId,
        canonicalName: modifier.canonicalName,
        severity: modifier.severity,
        flag: modifier.flag,
        source: modifier.source,
      })),
    };
  }
}
