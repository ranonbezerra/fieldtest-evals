import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, inciList: string[]): Promise<any> {
    return this.prisma.product.create({
      data: { name, inciList },
    });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async findAll(): Promise<any[]> {
    return this.prisma.product.findMany();
  }
}
