import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string): Promise<any> {
    return this.prisma.profile.create({ data: { name } });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.profile.findUnique({ where: { id } });
  }

  async addModifier(profileId: string, targetIngredient: string, newSeverity: string): Promise<any> {
    return this.prisma.profileModifier.create({
      data: { profileId, targetIngredient, newSeverity },
    });
  }

  async getModifiers(profileId: string): Promise<any[]> {
    return this.prisma.profileModifier.findMany({
      where: { profileId },
    });
  }
}
