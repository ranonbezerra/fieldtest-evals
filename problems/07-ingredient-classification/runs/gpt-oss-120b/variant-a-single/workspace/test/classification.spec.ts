import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationModule } from '../src/classification/classification.module';
import { ClassificationService } from '../src/classification/classification.service';

describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ClassificationModule],
    }).compile();

    service = module.get(ClassificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
