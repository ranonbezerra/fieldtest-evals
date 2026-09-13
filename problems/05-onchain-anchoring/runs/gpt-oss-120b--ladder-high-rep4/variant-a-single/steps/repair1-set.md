# repair1-set

## reasoning

```
We need to add .js extensions to imports. Also missing packages like class-validator, uuid, @nestjs/... In this environment, we assume they are installed, but TS can't find types due to ESM? Likely need to add extension .js to internal imports only. External packages fine. So modify all internal imports to include .js.

List files to change: all those with relative imports lacking .js. Add .js at end.

Also missing chain-client.interface file not shown; maybe extension needed? It's probably .ts, so import './chain-client.interface' should be './chain-client.interface.js'.

Proceed to edit each file accordingly.
```

## reply

### src/anchor/anchor-confirmation.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { IChainClient } from './chain-client.interface.js';
import { AnchorState } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
```

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { AnchorDocumentDto } from './dto/anchor-document.dto.js';
import { VerifyDto } from './dto/verify.dto.js';
import { AnchorState } from '@prisma/client';
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorConfirmationService } from './anchor-confirmation.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { IChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.js';
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Anchor, AnchorState } from '@prisma/client';
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { IChainClient } from './chain-client.interface.js';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../common/api-exception.js';
import { createHash } from 'crypto';
```

### src/anchor/dto/anchor-document.dto.ts
```ts
import { IsString, IsInt, IsNotEmpty } from 'class-validator';
```

### src/anchor/dto/verify.dto.ts
```ts
import { IsString, IsInt, IsNotEmpty } from 'class-validator';
```

### src/anchor/fake-chain-client.ts
```ts
import { IChainClient } from './chain-client.interface.js';
import { v4 as uuidv4 } from 'uuid';
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module.js';
import { AnchorModule } from './anchor/anchor.module.js';
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AnchorModule } from '../src/anchor/anchor.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorConfirmationService } from '../src/anchor/anchor-confirmation.service.js';
import { FakeChainClient } from '../src/anchor/fake-chain-client.js';
import { AnchorState } from '@prisma/client';
import { ApiException } from '../src/common/api-exception.js';
```
