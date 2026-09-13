import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string): Promise<any> {
    return this.prisma.ingredient.create({ data: { name } });
  }

  async findByName(name: string): Promise<any | null> {
    return this.prisma.ingredient.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.ingredient.findUnique({ where: { id } });
  }

  async findAll(): Promise<any[]> {
    return this.prisma.ingredient.findMany();
  }
}
