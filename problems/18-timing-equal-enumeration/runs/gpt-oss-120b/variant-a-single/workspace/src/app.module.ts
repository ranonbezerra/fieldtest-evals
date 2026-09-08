import { Module } from '@nestjs/common';

// ASSUMPTION: The auth feature module (./auth/auth.module) is not present in the
// repository, and creating it would violate the instruction to modify only the
// file(s) mentioned in the error messages. Therefore, the application module is
// defined without importing the missing auth module. This resolves the compile
// errors while preserving the existing project structure.

@Module({
  imports: [], // No feature modules are imported due to missing implementations.
  controllers: [],
  providers: [],
})
export class AppModule {}
