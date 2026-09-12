import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Product, ProductIngredient } from '@prisma/client';

@Injectable()
export class ProductsRepository {
  // ... (rest of the file remains unchanged)
}
