import { Injectable } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { Profile } from '@prisma/client';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepo: ProfileRepository) {}

  async create(name: string, type: string): Promise<Profile> {
    return this.profileRepo.createProfile(name, type);
  }

  async findById(id: number) {
    return this.profileRepo.findById(id);
  }
}
