# repair2-prisma.module.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/prisma/prisma.module.ts`:

```
src/prisma/prisma.module.ts(3,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
```

That's the only error in `prisma.module.ts`. It's on line 3, column 31, and it says it can't find `./prisma.service`.

Now, looking at the other errors, I see:
```
src/payout/payout.repository.ts(4,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
```

So `payout.repository.ts` also imports from `../prisma/prisma.service`. This means `prisma.service` is expected to exist as a file, but it doesn't exist yet.

The task says: "Rewrite `src/prisma/prisma.module.ts` complete, fixing what these messages require of this file."

The error is that `prisma.module.ts` imports `./prisma.service` which doesn't exist. But the task says "Change nothing the messages do not name."

The
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaModule } from './prisma.module';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
