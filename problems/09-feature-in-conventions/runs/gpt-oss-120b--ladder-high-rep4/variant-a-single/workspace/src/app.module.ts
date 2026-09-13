import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TripsModule } from './modules/trips/trips.module.js';

/**
 * A new feature module is registered here. That line is the only edit a feature
 * is expected to make outside its own directory and `drizzle/`.
 */
@Module({
  imports: [DbModule, UsersModule, TripsModule],
})
export class AppModule {}
