# repair1-operations.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/operations/operations.service.ts`:

1. `src/operations/operations.service.ts(2,15): error TS2305: Module '"@prisma/client"' has no exported member 'OrderStatus'.`

That's the only error
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository';
import { OperationsProjectionRepository } from './operations-projection.repository';
import { ListOperationsQuery, ListOperationsResult } from './operations.dto';

@Injectable()
export class OperationsService {
  constructor(
    private readonly operationsRepository: OperationsRepository,
    private readonly projectionRepository: OperationsProjectionRepository,
  ) {}

  async list(query: ListOperationsQuery): Promise<ListOperationsResult> {
    return this.projectionRepository.list(query);
  }

  async rederive(dateFrom: Date, dateTo: Date): Promise<void> {
    await this.projectionRepository.rederive(dateFrom, dateTo);
  }

  async driftRepair(): Promise<void> {
    await this.projectionRepository.driftRepair();
  }
}
```
