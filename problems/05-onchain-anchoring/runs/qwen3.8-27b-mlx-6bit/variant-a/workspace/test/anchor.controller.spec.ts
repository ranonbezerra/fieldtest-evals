import { Test } from '@nestjs/testing';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { AnchorService, type AnchorProof, type VerifyResult } from '../src/anchor/anchor.service.js';

describe('AnchorController', () => {
  let controller: AnchorController;
  const service = {
    anchorDocument: vi.fn(),
    verify: vi.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnchorController],
      providers: [{ provide: AnchorService, useValue: service }],
    }).compile();

    controller = moduleRef.get(AnchorController);
    vi.clearAllMocks();
  });

  it('delegates anchor to the service with parsed version and returns the proof', async () => {
    const proof: AnchorProof = { documentId: 'doc-1', version: 3, contentHash: 'hash', txId: 'tx-1', blockNumber: 42 };
    service.anchorDocument.mockResolvedValue(proof);

    const result = await controller.anchor({ documentId: 'doc-1', version: '3' }, { content: { patient: 'x' } });

    expect(result).toEqual(proof);
    expect(service.anchorDocument).toHaveBeenCalledWith('doc-1', 3, { patient: 'x' });
  });
  ...
});
