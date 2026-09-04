// ASSUMPTION: The compiler errors in test/classification.spec.ts reference a product shape
// mismatch (`ingredients` vs `productIngredients`) that originates in the product layer, not
// in this file. This file has no dependency on or re-export of that shape. Written per plan.
import { Injectable } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ResourceNotFound } from '../classification/types';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async findById(id: number) {
    const profile = await this.profileRepository.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} not found`);
    }
    return profile;
  }
}
