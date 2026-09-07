# repair1-order.controller.ts

## reasoning

```
We need to write order.controller fixing imports. Likely missing imports for Controller, Get, etc., and OrderService. Provide minimal code.

Assume OrderService exists. Use DTOs maybe. Just implement basic CRUD endpoints.

We must import from '@nestjs/common', and './order.service'.

Also ensure class exported.

Write:

import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async findAll() {
    return this.orderService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const order = await this.orderService.findOne(+id);
    if (!order) {
      throw new NotFoundException({ error: { code: 'resource_not_found', message: 'Order not found', details: {} } });
    }
    return order;
  }
}

Assume OrderService has methods.

Add assumptions comment.
```

## reply

```typescript
// src/order/order.controller.ts

import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';

// ASSUMPTION: An OrderService exists in the same directory with at least
// `findAll(): Promise<any[]>` and `findOne(id: number): Promise<any | null>` methods.
// The exact shape of Order DTOs is not provided, so we return whatever the service yields.

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async findAll() {
    // Returns a list of orders for the resolved tenant (tenant scoping is handled
    // by the Prisma middleware, not by this controller).
    return this.orderService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const order = await this.orderService.findOne(Number(id));
    if (!order) {
      // Conforms to the required error envelope.
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Order not found',
          details: {},
        },
      });
    }
    return order;
  }
}
```
