# repair2-auth.module.ts

## reasoning

```
We need to write auth.module.ts with correct imports. Likely need to import controller, service, repository, and PrismaModule? We don't have those files but assume exist. Use proper paths. Also need to export. Provide module definition.

We'll import { Module } from '@nestjs/common'; import AuthController from './auth.controller'; etc. Also need PrismaService? Not mentioned. Just include providers.

Write:

@Module({
 imports: [],
 controllers: [AuthController],
 providers: [AuthService, AuthRepository],
 exports: [AuthService],
})

Assume files exist.

Also need to import RefreshToken? No.

Write file.
```

## reply

```ts
// src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```
