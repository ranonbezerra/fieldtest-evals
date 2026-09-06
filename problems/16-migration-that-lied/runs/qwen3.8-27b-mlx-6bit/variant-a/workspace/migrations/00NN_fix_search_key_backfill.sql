BEGIN;

-- ASSUMPTION: the intended SET expression is lower(title); the broken migration's exact expression could not be inspected from the available references
UPDATE documents
SET search_key = lower(title)
WHERE search_key IS NULL;

COMMIT;
