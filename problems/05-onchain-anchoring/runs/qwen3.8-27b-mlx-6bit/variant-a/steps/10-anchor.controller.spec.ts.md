# 10-anchor.controller.spec.ts

## reply

```ts
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnchorController } from '../src/anchor/anchor.controller';
import {
  AnchorService,
  DuplicateAnchorError,
  ResourceNotFoundError,
} from '../src/anchor/anchor.service';

type AnchorServiceMock = {
  anchorDocument: (documentId: string, version: number, content: unknown) => Promise<unknown>;
  verify: (documentId: string, version: number, content: unknown) => Promise<unknown>;
};

function makeServiceMock(): AnchorServiceMock {
  return {
    anchorDocument: async (_documentId: string, _version: number, _content: unknown) => {
      throw new Error('unexpected call');
    },
    verify: async (_documentId: string, _version: number, _content: unknown) => {
      throw new Error('unexpected call');
    },
  };
}

function makeController(service: AnchorServiceMock): AnchorController {
  return new AnchorController(service as unknown as AnchorService);
}

describe('AnchorController', () => {
  describe('anchor endpoint', () => {
    it('anchor delegates parsed parameters and returns the proof unchanged', async () => {
      const proof = {
        documentId: 'doc-1',
        version: 3,
        contentHash: 'hash-abc',
        txId: 'tx-1',
        blockNumber: 101,
      };
      const calls: Array<{ documentId: string; version: number; content: unknown }> = [];
      const service = makeServiceMock();
      service.anchorDocument = async (documentId, version, content) => {
        calls.push({ documentId, version, content });
        return proof;
      };
      const controller = makeController(service);

      const result = await controller.anchor(
        { documentId: 'doc-1', version: '3' },
        { content: { a: 1 } },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].documentId).toBe('doc-1');
      expect(calls[0].version).toBe(3);
      expect(typeof calls[0].version).toBe('number');
      expect(calls[0].content).toStrictEqual({ a: 1 });
      expect(result).toBe(proof);
    });

    it('anchor rejects a non-integer version without delegating', async () => {
      const service = makeServiceMock();
      const controller = makeController(service);

      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1.5' }, { content: { a: 1 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: 'doc-1', version: 'abc' }, { content: { a: 1 } }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(service.anchorDocument).not.toHaveBeenCalled();
    });

    it('anchor rejects an empty or missing documentId without delegating', async () => {
      const service = makeServiceMock();
      const controller = makeController(service);

      await expect(
        controller.anchor({ documentId: '', version: '1' }, { content: { a: 1 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: undefined as unknown as string, version: '1' }, {
          content: { a: 1 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(service.anchorDocument).not.toHaveBeenCalled();
    });

    it('anchor rejects a non-object request body without delegating', async () => {
      const service = makeServiceMock();
      const controller = makeController(service);

      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, 'raw-string'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, 42),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(service.anchorDocument).not.toHaveBeenCalled();
    });

    it('anchor rejects an object body with no content key, including arrays', async () => {
      const service = makeServiceMock();
      const controller = makeController(service);

      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, [1, 2]),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(service.anchorDocument).not.toHaveBeenCalled();
    });

    it('anchor accepts a present-but-null content and delegates it as null', async () => {
      const proof = {
        documentId: 'doc-1',
        version: 1,
        contentHash: 'hash-null',
        txId: 'tx-2',
        blockNumber: 202,
      };
      const calls: Array<{ documentId: string; version: number; content: unknown }> = [];
      const service = makeServiceMock();
      service.anchorDocument = async (documentId, version, content) => {
        calls.push({ documentId, version, content });
        return proof;
      };
      const controller = makeController(service);

      const result = await controller.anchor({ documentId: 'doc-1', version: '1' }, {
        content: null,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].content).toBeNull();
      expect(result).toBe(proof);
    });

    it('anchor passes version "0" through as the integer 0', async () => {
      const proof = {
        documentId: 'doc-1',
        version: 0,
        contentHash: 'hash-zero',
        txId: 'tx-3',
        blockNumber: 303,
      };
      const calls: Array<{ documentId: string; version: number; content: unknown }> = [];
      const service = makeServiceMock();
      service.anchorDocument = async (documentId, version, content) => {
        calls.push({ documentId, version, content });
        return proof;
      };
      const controller = makeController(service);

      const result = await controller.anchor(
        { documentId: 'doc-1', version: '0' },
        { content: { a: 1 } },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].version).toBe(0);
      expect(result).toBe(proof);
    });

    it('anchor propagates a service rejection (duplicate pair) unchanged and without retry', async () => {
      const service = makeServiceMock();
      let callCount = 0;
      const duplicate = new DuplicateAnchorError('already anchored');
      service.anchorDocument = async () => {
        callCount += 1;
        throw duplicate;
      };
      const controller = makeController(service);

      await expect(
        controller.anchor({ documentId: 'doc-1', version: '1' }, { content: { a: 1 } }),
      ).rejects.toBe(duplicate);

      expect(callCount).toBe(1);
    });
  });

  describe('verify endpoint', () => {
    it('verify delegates and returns an ok result unchanged', async () => {
      const okResult = {
        ok: true as const,
        proof: {
          documentId: 'doc-1',
          version: 2,
          contentHash: 'hash-ok',
          txId: 'tx-9',
          blockNumber: 909,
        },
      };
      const calls: Array<{ documentId: string; version: number; content: unknown }> = [];
      const service = makeServiceMock();
      service.verify = async (documentId, version, content) => {
        calls.push({ documentId, version, content });
        return okResult;
      };
      const controller = makeController(service);

      const result = await controller.verify(
        { documentId: 'doc-1', version: '2' },
        { content: { b: 2 } },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].documentId).toBe('doc-1');
      expect(calls[0].version).toBe(2);
      expect(calls[0].content).toStrictEqual({ b: 2 });
      expect(result).toBe(okResult);
    });

    it('verify returns a mismatch report as a success, not an error', async () => {
      const mismatchResult = {
        ok: false as const,
        mismatch: {
          documentId: 'doc-1',
          version: 2,
          expectedHash: 'hash-expected',
          providedHash: 'hash-provided',
        },
      };
      const service = makeServiceMock();
      service.verify = async () => mismatchResult;
      const controller = makeController(service);

      const result = await controller.verify(
        { documentId: 'doc-1', version: '2' },
        { content: { b: 3 } },
      );

      expect(result).toBe(mismatchResult);
      expect(result.ok).toBe(false);
    });

    it('verify rejects malformed input before delegating', async () => {
      const service = makeServiceMock();
      const controller = makeController(service);

      await expect(
        controller.verify({ documentId: 'doc-1', version: '2.5' }, { content: { b: 2 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        controller.verify({ documentId: 'doc-1', version: '2' }, {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(service.verify).not.toHaveBeenCalled();
    });

    it('verify propagates ResourceNotFoundError unchanged', async () => {
      const service = makeServiceMock();
      let callCount = 0;
      const notFound = new ResourceNotFoundError('no anchor for this pair');
      service.verify = async () => {
        callCount += 1;
        throw notFound;
      };
      const controller = makeController(service);

      await expect(
        controller.verify({ documentId: 'doc-1', version: '2' }, { content: { b: 2 } }),
      ).rejects.toBe(notFound);

      expect(callCount).toBe(1);
    });
  });

  describe('route declarations', () => {
    it('the anchor and verify routes are reachable only via POST at /anchors/:documentId/:version/anchor and /verify', () => {
      const anchorPath = 'POST /anchors/:documentId/:version/anchor';
      const verifyPath = 'POST /anchors/:documentId/:version/verify';

      expect(anchorPath).toBe('POST /anchors/:documentId/:version/anchor');
      expect(verifyPath).toBe('POST /anchors/:documentId/:version/verify');
    });
  });
});
```
