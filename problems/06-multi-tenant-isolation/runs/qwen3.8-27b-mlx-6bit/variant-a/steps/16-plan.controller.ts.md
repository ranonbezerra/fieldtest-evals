# 16-plan.controller.ts

## reasoning

```
Let me analyze what's needed for `src/plan/plan.controller.ts` based on the PLAN.md and the references provided.

From PLAN.md:
- PlanController is in `src/plan/plan.controller.ts`
- It has CRUD endpoints for plans
- Endpoints follow `kebab-case` plural convention: `/plans`
- Controller validates input and calls the service. Zero business logic.
- The controller reads: `src/plan/plan.service.ts`, `src/plan/dto.ts`

From the references:
- `PlanService` has methods: `list()`, `findById(id)`, `create(input)`, `update(id, input)`, `delete(id)`
- DTOs: `CreatePlanInput { name, priceCents }`, `UpdatePlanInput { name?, priceCents? }`, `Plan`

The controller needs:
- `@Controller('plans')` - kebab-case plural
- `GET /plans` → list
- `POST /plans` → create
- `GET /plans/:id` → findById
- `PATCH /plans/:id` → update
- `DELETE /plans/:id` → delete

The controller validates input and delegates to service. Zero business logic.

Let me write this following the conventions:
- TypeScript strict
- ESM imports (with `.js` extension based on the reference files)
- NestJS decorators
- Layer: controller validates input, calls service, zero business logic

Looking at the reference `plan.service.ts`, it imports from `'./plan.repository.js'` and `'../multi-tenant/errors.js'` with `.js` extensions, confirming ESM style.

For the controller:
- Import from `@nestjs/common`
- Import `PlanService` from `./plan.service.js`
- Import DTOs from `./dto.js`

Let me write the complete file:
```

## reply

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { PlanService } from './plan.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

@Controller('plans')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  async list(): Promise<Plan[]> {
    return this.planService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<Plan> {
    return this.planService.findById(id);
  }

  @Post()
  async create(@Body() input: CreatePlanInput): Promise<Plan> {
    return this.planService.create(input);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() input: UpdatePlanInput,
  ): Promise<Plan> {
    return this.planService.update(id, input);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.planService.delete(id);
  }
}
```
