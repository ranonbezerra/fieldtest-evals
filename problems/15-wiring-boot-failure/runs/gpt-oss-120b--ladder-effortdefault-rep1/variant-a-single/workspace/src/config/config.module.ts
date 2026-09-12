import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service.js';

/** Global: any module may inject ConfigService without importing this one. */
@Global()
@Module({ providers: [ConfigService], exports: [ConfigService] })
export class ConfigModule {}
