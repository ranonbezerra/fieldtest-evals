# 04-00NN_fix_search_key_backfill.sql

## reasoning

```
The user wants me to write exactly one file: `migrations/00NN_fix_search_key_backfill.sql`

From the PLAN.md, this file should:
- Be a single `UPDATE documents SET search_key = … WHERE search_key IS NULL;`
- Wrapped in `BEGIN; … COMMIT;`
- Be plain SQL, no parameterisation

The plan says: "Write `migrations/00NN_fix_search_key_backfill.sql` — Single `UPDATE … WHERE search_key IS NULL;`. Wrap in `BEGIN; … COMMIT;`."

Now, what should `search_key` be set to? The plan says "UPDATE documents SET search_key = … WHERE search_key IS NULL". The exact expression for what search_key should be is not fully specified in the plan. Looking at the data model, `search_key` is a `text` column on `documents`. The plan's section 4 Phase 3 says: "Write `migrations/00NN_fix_search_key_backfill.sql`. Single `UPDATE … WHERE search_key IS NULL;`. Wrap in `BEGIN; … COMMIT;`."

The manifest says: "UPDATE documents SET search_key … WHERE search_key IS NULL"

The exact value to set `search_key` to is not explicitly given. However, looking at the context: "a report that should show a backfilled `search_key` for every document shows it for none." This implies search_key should be derived from the document's data.

The most common pattern for a "search_key" would be something like `lower(title)` or `title` or some combination. But the plan doesn't specify the exact expression.

Wait, let me re-read. The plan says the backfill migration should "populate `documents.search_key`" and the defect B is that "the UPDATE matches zero rows." The mechanism could be "wrong column name, wrong table, WHERE clause that is always false, the statement is inside a DO block that swallows the error, or it targets a table not yet populated at that migration position."

The plan says for the fix: "Single `UPDATE … WHERE search_key IS NULL;`"

Since I don't have access to the actual broken migration to see what the intended expression was, and the plan doesn't specify the exact SET expression, I need to make a reasonable assumption. 

Looking at the context: "a report that should show a backfilled `search_key` for every document" — this is a search key, likely derived from the title or some combination of fields. The most defensible reading for a "search_key" would be `lower(title)` as it's a common pattern for search keys (lowercased, normalized title).

Actually, I should mark this as an assumption since the exact expression is not specified in either the plan or the references. Let me write it with an ASSUMPTION comment.

Wait, the instructions say: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

But this is a SQL file, so the comment syntax should be `--` not `//`. Let me use SQL comment syntax.

Actually, re-reading: "mark it with one `// ASSUMPTION:` comment" — but in SQL, comments are `--`. I'll use `--` since this is a SQL file and the instruction's intent is clear (mark it at the point it matters).

Let me write the file:

```sql
BEGIN;

-- ASSUMPTION: the intended expression for search_key is lower(title); the original broken migration's SET clause could not be inspected
UPDATE documents
SET search_key = lower(title)
WHERE search_key IS NULL;

COMMIT;
```

This is complete, follows the plan (single UPDATE, WHERE search_key IS NULL, wrapped in BEGIN/COMMIT), and marks the one unresolved point.
```

## reply

```sql
BEGIN;

-- ASSUMPTION: the intended SET expression is lower(title); the broken migration's exact expression could not be inspected from the available references
UPDATE documents
SET search_key = lower(title)
WHERE search_key IS NULL;

COMMIT;
```
