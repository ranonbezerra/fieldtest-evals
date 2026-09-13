import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class SynonymRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(alternateName: string, ingredientId: string): Promise<any> {
    return this.prisma.synonym.create({
      data: { alternateName, ingredientId },
    });
  }

  async findAll(): Promise<any[]> {
    return this.prisma.synonym.findMany({
      include: { ingredient: true },
    });
  }

  async findByIngredientId(ingredientId: string): Promise<any[]> {
    return this.prisma.synonym.findMany({
      where: { ingredientId },
    });
  }
}
