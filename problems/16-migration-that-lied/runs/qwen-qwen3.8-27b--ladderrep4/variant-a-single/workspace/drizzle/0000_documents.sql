CREATE TABLE "documents" (
  "id"         uuid PRIMARY KEY,
  "title"      text NOT NULL,
  "body"       text NOT NULL,
  "slug"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "documents_slug_key" ON "documents" ("slug");

-- Documents that existed before this schema was extracted from the monolith.
-- Slugs carried the 'slug:' prefix the old CMS wrote.
INSERT INTO "documents" ("id", "title", "body", "slug") VALUES
  ('11111111-1111-4111-8111-000000000001', 'Onboarding',     'How to get started.',      'slug:onboarding-guide'),
  ('11111111-1111-4111-8111-000000000002', 'Refund policy',  'Thirty days, no quibble.', 'slug:refund-policy'),
  ('11111111-1111-4111-8111-000000000003', 'Security',       'Report issues here.',      'slug:security-overview'),
  ('11111111-1111-4111-8111-000000000004', 'Data retention', 'We keep logs 90 days.',    'slug:data-retention'),
  ('11111111-1111-4111-8111-000000000005', 'Service levels', 'Ninety-nine point nine.',  'slug:service-levels');
