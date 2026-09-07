# repair1-anchor.module.ts

## reasoning

```
We need to create module file importing correct paths. Likely other files missing, but we just need to rewrite module to match imports that exist. Since many files missing, we assume they will be created elsewhere. Provide imports referencing correct relative paths.

Typically:

import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { PrismaService } from '../prisma.service';
import { ChainClientInterface } from './chain-client.interface';
import { FakeChainClientService } from './fake-chain-client.service';

Provide providers: AnchorService, AnchorRepository, PrismaService, { provide: 'ChainClientInterface', useClass: FakeChainClientService }

Exports maybe AnchorService.

@Module({
  controllers: [AnchorController],
  providers: [AnchorService, AnchorRepository, PrismaService, { provide: 'ChainClientInterface', useClass: FakeChainClientService }],
  exports: [AnchorService],
})
export class AnchorModule {}

Add ASSUMPTION lines for missing files.
```

## reply

```ts
// src/anchor/anchor.module.ts
import { Module } from '@nestjs/common';

// ASSUMPTION: The following files exist in the repository with the expected
// class/interface exports. They are referenced here to satisfy the compiler
// errors listed in the task description.

import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { PrismaService } from '../prisma.service';
import { ChainClientInterface } from './chain-client.interface';
import { FakeChainClientService } from './fake-chain-client.service';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    PrismaService,
    // The chain client is injected via the interface token.
    {
      provide: ChainClientInterface,
      useClass: FakeChainClientService,
    },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
```
