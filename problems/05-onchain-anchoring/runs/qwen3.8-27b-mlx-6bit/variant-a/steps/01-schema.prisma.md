# 01-schema.prisma

## reasoning

```
We need answer user's request: write exactly one file prisma/schema.prisma complete fenced block only. Need follow plan. Need analyze in English same language as user (English). Need produce final only fenced code, no explanation.

Need infer required schema.prisma content. Plan says: Data model `Anchor` (`@@map("anchors")`) — only persistent structure.
- id String @id @default(cuid())
- documentId String @map("document_id")
- version Int @map("version")
- contentHash String @map("content_hash")
- content String @map("content")
- txId String @map("tx_id") — populated after prepare, before broadcast. But in types NewAnchor txId: string | null; AnchorRecord txId string|null. Plan control flow create row with state=pending, txId=null then updateState txId. So field must be optional? It says `txId` String, @map("tx_id") — populated after prepare, before broadcast. But state pending has null. In Prisma if String non-nullable cannot insert null. Since plan says row with txId=null before broadcast and NewAnchor txId: string|null, AnchorRecord txId string|null. Therefore schema should be String? @map("tx_id") optional. The plan bullet omitted ? but control flow requires nullable. Need defensible reading: make txId String? because persisted before broadcast may be null. Also blockNumber Int? @map("block_number"). state String @map("state") one of pending... no enum? Plan says String. Could use String? Better String. createdAt DateTime @default(now()) @map("created_at"), updatedAt DateTime @updatedAt @map("updated_at"). Unique composite @@unique([documentId, version]).

Need datasource and generator. Environment: Prisma PostgreSQL, DATABASE_URL env. Need generator client provider "prisma-client-js"? Stack TypeScript ESM Node 20 NestJS Prisma. Usually schema.prisma:
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

Could there be previewFeatures? Not necessary. Need maybe output? No.

Need exactly plan: "Anchor model, unique composite, snake_case mapping". Do not add features. But generator/datasource required for schema file. The plan says migration generated from schema; no hand-written. Need include datasource/generator.

Potential issue: model name Anchor, table anchors. Fields snake_case via @map. Composite unique: @@unique([documentId, version]) maybe mapped? In Prisma can map compound unique to snake? `@@unique([documentId, version], map: "document_id_version")`? Not required but snake_case column names. Convention table and column snake_case. Unique index name can be snake? Could add map for clarity: `@@unique([documentId, version], map: "anchors_document_id_version_key")`? Plan only says unique composite. Adding map not a feature? It's mapping. But maybe avoid extra not specified. However Prisma default index name okay. Need ensure no duplicate anchors enforced schema level: @@unique([documentId, version]).

Need consider enum state? Plan says String. Use String to avoid extra enum model not named.

Need think about content: raw JSON string. Prisma String maps to text? In Postgres String => varchar? Actually Prisma String maps to TEXT? I think String is TEXT. Good.

Need maybe `id` default cuid. Plan says cuid. Good.

Need maybe `version` Int. Good.

Need nullable txId: should be String? because state pending before prepare. But plan bullet says `txId` String, @map("tx_id") — populated after prepare, before broadcast. It doesn't explicitly say optional, but later "create a row with state=pending, txId=null". So must be optional. Could mark `String?`. Is that a deviation? It's necessary. Maybe no ASSUMPTION comment because plan resolves via control flow. Need not include comments? Could include minimal? User says complete file. Comments okay but not necessary. Avoid comments unless assumption. No unresolved.

Need final only fenced block. Ensure no extra text.

Double-check if Prisma schema needs `model Anchor { ... }` and `@@map("anchors")`. Field names camelCase in TS, mapped snake. Good.

Potential: `updatedAt` DateTime @updatedAt @map("updated_at")`. Good.

Potential: Prisma generator provider maybe "prisma-client" for new? In Node 20 ESM, Prisma 5/6 default `prisma-client-js`. Use that. If repo uses Prisma? No package.json unknown. Most defensible: `provider = "prisma-client-js"`.

Potential: datasource provider "postgresql". url env("DATABASE_URL"). Good.

Need consider ESM? No effect.

Could include `previewFeatures = ["fullTextIndex"]` no.

Need final:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Anchor {
  id           String   @id @default(cuid())
  documentId   String   @map("document_id")
  version      Int
  contentHash  String   @map("content_hash")
  content      String   @map("content")
  txId         String?  @map("tx_id")
  state        String   @map("state")
  blockNumber  Int?     @map("block_number")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@map("anchors")
}
```

Need check plan says `version Int, @map("version")` but mapping same name unnecessary. Could omit @map for version? Convention says via @map for snake_case. But column name same as field, no need. The plan explicitly says `@map("version")`. Should we include? It's harmless. But if field version Int, `@map("version")` maps to same. Could include to match plan. Also `content @map("content")`, `state @map("state")`. Plan says those. Include all.

Need think about unique composite and nullable fields? Unique includes documentId version non-null. Good.

Potential issue: `txId` optional but plan's AnchorRecord says string | null. Good.

Could there be need for `content` as Json? Plan says String raw JSON. Use String.

Could there be need for `state` default "pending"? Plan create with state pending explicitly. Not required. Avoid adding default not specified? Could add @default("pending")? Plan doesn't specify. Don't add.

Could there be need for `blockNumber` Int? nullable. Good.

Need ensure no extra file content. Final fenced block only. The user says "Reply with the complete content ... inside one fenced block, and nothing else". Use ```prisma maybe. Good.

Need ensure no hidden issue with "Do not add an export, a feature or a file the plan does not name." Generator and datasource are required schema parts. Not extra feature.

Need maybe mention `ASSUMPTION` if txId nullable? But plan control flow resolves; no.

Let's final.
```

## reply

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Anchor {
  id          String   @id @default(cuid())
  documentId  String   @map("document_id")
  version     Int      @map("version")
  contentHash String   @map("content_hash")
  content     String   @map("content")
  txId        String?  @map("tx_id")
  state       String   @map("state")
  blockNumber Int?     @map("block_number")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([documentId, version])
  @@map("anchors")
}
```
