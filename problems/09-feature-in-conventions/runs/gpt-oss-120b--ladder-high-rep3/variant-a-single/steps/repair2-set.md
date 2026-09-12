# repair2-set

## reasoning

```
We need to adjust import path extension .js? In other imports they use .js for compiled ESM. In app.module.ts they import TripsModule from './modules/trips/trips.module'; missing .js. So add .js extension.

Let's edit src/app.module.ts.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TripsModule } from './modules/trips/trips.module.js';

@Module({
  imports: [DbModule, UsersModule, TripsModule],
})
export class AppModule {}
```
