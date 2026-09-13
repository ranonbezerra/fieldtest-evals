import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly repository: ProfilesRepository) {}

  async create(name: string) {
    return this.repository.create(name);
  }

  async getById(id: string) {
    return this.repository.getById(id);
  }

  async addModifier(profileId: string, field: string, severity: string, description: string) {
    return this.repository.addModifier(profileId, field, severity, description);
  }
}
