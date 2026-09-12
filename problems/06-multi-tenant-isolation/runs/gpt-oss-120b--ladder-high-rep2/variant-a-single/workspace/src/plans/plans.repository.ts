import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Plan } from '@prisma/client';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlanDto): Promise<Plan> {
    return this.prisma.plan.create({ data: dto });
  }

  async findAll(): Promise<Plan[]> {
    return this.prisma.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findFirst({ where: { id } });
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  async delete(id: string): Promise<Plan> {
    return this.prisma.plan.delete({ where: { id } });
  }
}
