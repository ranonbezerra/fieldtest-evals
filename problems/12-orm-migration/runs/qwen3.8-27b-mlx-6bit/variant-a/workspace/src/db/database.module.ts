import { Global, Module } from '@nestjs/common';
import { createDb } from './client.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
