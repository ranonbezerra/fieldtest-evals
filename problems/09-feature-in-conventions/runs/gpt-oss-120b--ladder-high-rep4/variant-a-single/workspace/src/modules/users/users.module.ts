import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/**
 * A provider another module needs is exported here and imported there.
 * An unresolved dependency typechecks perfectly and fails at boot.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
