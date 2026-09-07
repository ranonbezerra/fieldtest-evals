import { Module } from '@nestjs/common';
import { UsersModule } from './modules/users/users.module';
import { TripsModule } from './modules/trips/trips.module';

@Module({
  imports: [UsersModule, TripsModule],
})
export class AppModule {}
