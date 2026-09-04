import { Injectable } from '@nestjs/common';
import { PrismaClient, Profile, ProfileModifier } from '@prisma/client';

// ASSUMPTION: The test-file errors about `ingredients` vs `productIngredients`
// reference a product-with-ingredients domain type defined in the product layer
// (e.g. product.repository.ts). This file cannot alter that type; the mismatch
// is between the test's mock objects (using the Prisma relation name
// `productIngredients`) and the domain type (which uses `ingredients`). Fixing
// it requires a change in the product layer or the test file itself.

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { id } });
  }

  async getModifiers(profileId: number): Promise<ProfileModifier[]> {
    return this.prisma.profileModifier.findMany({ where: { profileId } });
  }
}
