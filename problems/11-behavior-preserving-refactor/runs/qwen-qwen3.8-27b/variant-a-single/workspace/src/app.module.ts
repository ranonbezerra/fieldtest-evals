import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PayoutsModule } from './payouts/payouts.module.js';

@Module({
  imports: [PrismaModule, OrdersModule, PayoutsModule],
})
export class AppModule {}
