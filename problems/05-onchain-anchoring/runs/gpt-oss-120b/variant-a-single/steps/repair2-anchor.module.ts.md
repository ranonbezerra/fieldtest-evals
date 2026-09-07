# repair2-anchor.module.ts

## reasoning

```
We need to write anchor.module.ts with correct imports. Likely files exist but path? According to errors, missing modules. Probably actual filenames are different. We assume they are in same folder: anchor.controller.ts, anchor.service.ts, anchor.repository.ts, chain-client.interface.ts, fake-chain-client.service.ts, and prisma.service.ts is at src/prisma.service.ts.

So anchor.module.ts should import those correctly.

Provide NestJS Module with imports [] and providers [AnchorService, AnchorRepository, FakeChainClientService, PrismaService] and controllers [AnchorController].

Also export AnchorService maybe.

Write file.
```

## reply

```ts
// src/anchor/anchor.module.ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { PrismaService } from '../prisma.service';
import { FakeChainClientService } from './fake-chain-client.service';
import { ChainClientInterface } from './chain-client.interface';

@Module({
  imports: [],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    PrismaService,
    {
      // Provide the chain client via its interface token.
      provide: ChainClientInterface,
      useClass: FakeChainClientService,
    },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
```
