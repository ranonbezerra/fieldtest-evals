# repair1-set

## reasoning

```
We need to fix import extension .js? In TS with ES module, should import without .js maybe .js is okay if compiled. But file likely named trips.module.ts compiled to .js. Import should be './modules/trips/trips.module.js' but ts can't find .js. Should use .js? Actually tsconfig with moduleResolution node16 and "type": "module" expects .js extensions. The compiled .js will exist after build, but ts can't find .js source. Need to import without extension: './modules/trips/trips.module'. Let's edit src/app.module.ts.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TripsModule } from './modules/trips/trips.module';

@Module({
  imports: [DbModule, UsersModule, TripsModule],
})
export class AppModule {}
```
