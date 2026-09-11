import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get(key: string, fallback = ''): string {
    return process.env[key] ?? fallback;
  }
}
