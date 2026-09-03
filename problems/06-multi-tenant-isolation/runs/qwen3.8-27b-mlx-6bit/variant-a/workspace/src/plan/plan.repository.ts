import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

export class PlanRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Plan[]> {
    return this.db.plan.findMany();
  }

  async findById(id: string): Promise<Plan | null> {
    return this.db.plan.findUnique({ where: { id } });
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    return this.db.plan.create({ data: input });
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.db.plan.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.plan.delete({ where: { id } });
  }
}
