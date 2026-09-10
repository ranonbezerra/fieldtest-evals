import type { Prisma } from '@prisma/client';

// ASSUMPTION: Prisma exports TransactionClient as the type of the client handed
// to an interactive-transaction callback (it does in Prisma 5/6). Repository
// methods accept either that client or the base client, so the same code runs
// inside and outside a transaction.
export type DbClient = Prisma.TransactionClient;
