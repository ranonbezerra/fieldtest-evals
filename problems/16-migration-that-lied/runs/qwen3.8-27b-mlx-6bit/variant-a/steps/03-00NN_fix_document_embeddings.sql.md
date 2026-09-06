# 03-00NN_fix_document_embeddings.sql

## reasoning

```
The task asks me to write exactly one file: `migrations/00NN_fix_document_embeddings.sql`.

From the PLAN.md, I know:
- This file should contain: `CREATE TABLE IF NOT EXISTS document_embeddings (…)`.
- If a root cause is a missing extension, the file begins with `CREATE EXTENSION IF NOT EXISTS …;`.
- Wrap in `BEGIN; … COMMIT;`.
- If a `CREATE INDEX` or unique constraint is part of the intended schema, it ships in the same file as the `CREATE TABLE`.
- The naming convention is `00NN_description.sql`.

From the data model in PLAN.md:
- `document_embeddings.id` — `uuid` PK
- `document_embeddings.document_id` — `uuid` FK → `documents(id)` ON DELETE CASCADE
- `document_embeddings.model` — `text` NOT NULL
- `document_embeddings.vector` — `vector(1536)` (pgvector) or `float8[]` fallback
- `document_embeddings.created_at` — `timestamptz` DEFAULT now()

The plan says "The precise `<NN>` and column definitions are taken from the diagnosis." But I don't have the actual diagnosis results. I need to use the most defensible reading from what's available.

For the NN number: The plan says "New migration files are named with the next sequential timestamp after the last existing one." I don't know what the last existing migration number is. This is genuinely absent from both the plan and references. I'll use a placeholder that makes sense — but actually, the plan says the implementer writes this during diagnosis. Since I can't know the exact number, I'll use a reasonable assumption. Let me mark it with an ASSUMPTION comment.

Wait, actually re-reading: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The NN number is genuinely absent. I'll use something like `0004` as a reasonable next number and mark it.

For the extension: The plan says "If the root cause is a missing extension, the file begins with `CREATE EXTENSION IF NOT EXISTS …;`." The data model mentions `vector(1536)` (pgvector). The variant task mentions "If an extension cannot be installed on the image the compose file specifies, that is a finding, not an obstacle to work around by removing the requirement." This suggests the extension IS required. So I should include `CREATE EXTENSION IF NOT EXISTS vector;`.

For the vector column: The plan says `vector(1536)` (pgvector) or `float8[]` fallback. Since the plan prioritizes pgvector (it's listed first) and the task says not to work around by removing the requirement, I'll use `vector(1536)`.

For indexing: The plan says "If a `CREATE INDEX` or unique constraint is part of the intended schema, it ships in the same file as the `CREATE TABLE`." A FK on `document_id` is common. I'll add a unique index on `(document_id, model)` which makes sense for embeddings (one embedding per document per model). Actually, I'm not sure about this. Let me think...

Actually, the plan doesn't explicitly state what index to create. It just says "If a CREATE INDEX or unique constraint is part of the intended schema, it ships in the same file." Since I don't know the exact intended schema from the original broken migration, I should be conservative. A standard practice would be an index on `document_id` for the FK lookup. But I shouldn't invent constraints not in the plan.

Wait, the plan's data model table doesn't mention any index or unique constraint explicitly. It only mentions columns. Let me be conservative and just create the table with its columns, the PK, and the FK. I'll skip the extra index since it's not explicitly called out in the data model.

Actually, re-reading the manifest: "migrations/00NN_fix_document_embeddings.sql | reads: - | CREATE TABLE IF NOT EXISTS + required index/extension"

It says "required index/extension". The extension is required (pgvector for the vector type). An index — well, a FK typically benefits from an index but isn't "required" per se. I'll include a simple index on `document_id` since it's the FK and is standard practice, and the manifest says "required index/extension" suggesting both should be present.

Let me write the file:

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

// ASSUMPTION: migration number 0004 is the next sequential after existing migrations; exact number unresolved from references
CREATE TABLE IF NOT EXISTS document_embeddings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    model       text NOT NULL,
    vector      vector(1536),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id ON document_embeddings (document_id);

COMMIT;
```

Wait, SQL doesn't use `//` for comments. It uses `--`. Let me fix that.

Also, `gen_random_uuid()` is available in PostgreSQL 13+ without an extension (it's built-in). That should be fine.

Let me reconsider the `// ASSUMPTION` vs `-- ASSUMPTION`. The instructions say to write `// ASSUMPTION: ...` but in SQL that's not valid syntax. I'll use `-- ASSUMPTION:` since the file is SQL and `//` would be a syntax error.

Actually wait, re-reading the instruction: "mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters." This is a general instruction about format. In SQL, the comment marker is `--`. I'll use `--` to keep the file valid SQL.

Let me finalize.
```

## reply

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ASSUMPTION: migration sequence number 0004 is the next after the last existing migration; exact value unresolved from available references

CREATE TABLE IF NOT EXISTS document_embeddings (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    model       text        NOT NULL,
    vector      vector(1536),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id
    ON document_embeddings (document_id);

COMMIT;
```
