# repair2-prisma.module.ts

## reasoning

```
We need to write prisma.module.ts to resolve imports. Likely need to import PrismaService from ./prisma.service which doesn't exist; we can create a placeholder class inside same file? But cannot create new files. We can define PrismaService in this module file and export it, satisfying imports elsewhere. Also need to export PrismaClient types like Message, etc. Those are from @prisma/client generated. Assuming schema includes Message model. We just need to re-export PrismaClient? Actually other files import { Message } from '@prisma/client'; error says no exported member 'Message'. If schema doesn't have Message, we assume it does. But we cannot change other files. We can augment by creating a declaration module that re-exports type. But easiest: add export type Message = any; but import from '@prisma/client' expects exported member. We cannot modify that library. Instead we can create a file that re-exports from @prisma/client with a dummy type? Not possible. However we can add a declaration merging: declare module '@prisma/client' { interface Message {} } but need to add type. Could create a .d.ts file, but not allowed. Probably assume Message exists; the error due to missing generated client because prisma client not generated. We can create a mock PrismaService that defines Message type via PrismaClient import. We need to import PrismaClient from '@prisma/client'. That client will have .message? Actually model Message would generate PrismaClient with property message. Types include Message. So if schema includes Message, the type exists. The error maybe because prisma client not generated; but we can't generate. We'll assume it's there; just need to import PrismaService correctly.

Implement prisma.module.ts:

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

Also need to create PrismaService class in same file to satisfy missing file.

Implement:

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

Thus other imports of PrismaService will work.

Return file content.
```

## reply

```ts
// src/prisma/prisma.module.ts

import { Module, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService wraps the generated PrismaClient and manages its lifecycle.
 * It is exported so that other modules (repositories, services, etc.) can
 * inject it and use the typed client.
 *
 * // ASSUMPTION: The Prisma schema defines a `Message` model (and any other
 * // models referenced elsewhere). The generated `@prisma/client` therefore
 * // exports a `Message` type, satisfying the imports in other files.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * PrismaModule makes PrismaService available to the rest of the application.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
