import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';

describe('Application wiring', () => {
  it('should compile the Nest application context without errors', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
