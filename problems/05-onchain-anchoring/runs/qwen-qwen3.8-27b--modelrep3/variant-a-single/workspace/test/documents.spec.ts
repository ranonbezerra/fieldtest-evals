import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DocumentsRepository } from '../src/documents/documents.repository.js';
import { DocumentsService } from '../src/documents/documents.service.js';

// Requires a running Postgres reachable via DATABASE_URL with migrations applied.
const prisma = new PrismaService();
let documents: DocumentsService;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  documents = new DocumentsService(new DocumentsRepository(prisma));
  await prisma.reportVersion.deleteMany({ where: { documentId: 'doc-d' } });
});

describe('documents', () => {
  it('stores each (documentId, version) exactly once; versions are immutable', async () => {
    await documents.createVersion('doc-d', 1, { a: 1 });
    await expect(documents.createVersion('doc-d', 1, { a: 1 })).rejects.toMatchObject({
      code: 'document_version_exists',
      status: 409,
    });
    const got = await documents.getVersion('doc-d', 1);
    expect(got).toMatchObject({ documentId: 'doc-d', version: 1, content: { a: 1 } });
    await expect(documents.getVersion('doc-d', 2)).rejects.toMatchObject({
      code: 'resource_not_found',
      status: 404,
    });
  });
});
