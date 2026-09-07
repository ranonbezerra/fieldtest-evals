import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { ProfileRepository } from './profile.repository.js';

// ASSUMPTION: @prisma/client has not been generated in this workspace, so it does
// not export a `Severity` enum. The type is defined locally to match the schema
// values and is re-exported for consumers that need it.
export type Severity = 'banned' | 'restricted' | 'watch';

export interface ModifierDto {
  canonicalName: string;
  severity: Severity;
  flag: string;
  source: string;
}

export interface ProfileDto {
  id: string;
  name: string;
  description: string | null;
  modifiers: ModifierDto[];
}

@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async create(name: string, description?: string): Promise<ProfileDto> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw Errors.duplicate('Profile', { name });
    }
    return this.repository.create(name, description ?? null);
  }

  // ASSUMPTION: The repository exposes findById returning a profile shape that
  // includes its modifiers array (as consumed by ClassificationService).
  async getById(id: string): Promise<ProfileDto> {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw Errors.notFound('Profile', { id });
    }
    return profile;
  }

  async list(): Promise<ProfileDto[]> {
    return this.repository.findAll();
  }

  async addModifier(
    profileId: string,
    canonicalName: string,
    severity: Severity,
    flag: string,
    source: string,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(profileId);
    if (!profile) {
      throw Errors.notFound('Profile', { profileId });
    }
    await this.repository.addModifier(profileId, canonicalName, severity, flag, source);
    return this.getById(profileId);
  }

  async removeModifier(profileId: string, canonicalName: string): Promise<ProfileDto> {
    const profile = await this.repository.findById(profileId);
    if (!profile) {
      throw Errors.notFound('Profile', { profileId });
    }
    await this.repository.removeModifier(profileId, canonicalName);
    return this.getById(profileId);
  }

  async remove(id: string): Promise<void> {
    const profile = await this.repository.findById(id);
    if (!profile) {
      throw Errors.notFound('Profile', { id });
    }
    await this.repository.remove(id);
  }
}
