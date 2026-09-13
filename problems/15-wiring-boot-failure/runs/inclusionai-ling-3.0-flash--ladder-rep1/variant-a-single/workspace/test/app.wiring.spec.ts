import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('builds the real application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
  });
});
