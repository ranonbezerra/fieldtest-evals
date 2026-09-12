import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Order } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    return this.prisma.order.create({ data: dto });
  }

  async findAll(): Promise<Order[]> {
    return this.prisma.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.prisma.order.findFirst({ where: { id } });
  }

  async delete(id: string): Promise<Order> {
    return this.prisma.order.delete({ where: { id } });
  }
}
