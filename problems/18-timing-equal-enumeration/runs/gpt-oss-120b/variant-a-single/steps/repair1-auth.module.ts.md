# repair1-auth.module.ts

## reasoning

```
We need to write auth.module.ts that imports controller, service, repository. Paths must be correct. Probably files exist. We'll just export them. Use NestJS Module decorator. Also need to import MailService? Not needed. Provide repository and service. Export service? Not required.

Write:

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}

Assume files exist. That's it.
```

## reply

```ts
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```
