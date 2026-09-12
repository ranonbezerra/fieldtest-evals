import { Injectable } from '@nestjs/common';
import { OrdersRepository } from './orders.repository.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { Order } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    return this.repo.create(dto);
  }

  async findAll(): Promise<Order[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Order | null> {
    return this.repo.findById(id);
  }

  async remove(id: string): Promise<Order | null> {
    try {
      return await this.repo.delete(id);
    } catch (err) {
      return null;
    }
  }
}
