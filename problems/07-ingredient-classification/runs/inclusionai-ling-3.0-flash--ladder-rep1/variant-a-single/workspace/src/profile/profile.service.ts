import { Injectable } from "@nestjs/common";
import { ProfileRepository } from "./profile.repository.js";
import { AppException } from "../common/app-exception.js";

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepo: ProfileRepository) {}

  async create(name: string): Promise<any> {
    return this.profileRepo.create(name);
  }

  async getById(id: string): Promise<any | null> {
    return this.profileRepo.findById(id);
  }

  async addModifier(profileId: string, targetIngredient: string, newSeverity: string): Promise<any> {
    const profile = await this.profileRepo.findById(profileId);
    if (!profile) {
      throw new AppException("profile_not_found", "Profile not found", 404);
    }
    return this.profileRepo.addModifier(profileId, targetIngredient, newSeverity);
  }

  async getModifiers(profileId: string): Promise<any[]> {
    return this.profileRepo.getModifiers(profileId);
  }
}
