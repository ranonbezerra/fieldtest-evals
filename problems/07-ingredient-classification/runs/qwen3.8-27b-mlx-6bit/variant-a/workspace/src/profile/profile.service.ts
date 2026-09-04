import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { ProfileRepository } from './profile.repository.js';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async findById(id: number): Promise<Profile | null> {
    return this.profileRepository.findById(id);
  }
}
