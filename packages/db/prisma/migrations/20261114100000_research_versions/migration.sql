-- Research versions (ADR-0034): every refresh is kept. The current sources of each research become
-- its first version; the per-source snapshots of trends, market and review are then not needed.
CREATE TABLE "research_version" (
    "id" UUID NOT NULL,
    "researchId" UUID NOT NULL,
    "keywords" TEXT[],
    "trends" JSONB NOT NULL,
    "market" JSONB NOT NULL,
    "tags" JSONB,
    "review" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_version_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "research_version_researchId_createdAt_idx" ON "research_version"("researchId", "createdAt");

ALTER TABLE "research_version" ADD CONSTRAINT "research_version_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "research"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "research_version" ("id", "researchId", "keywords", "trends", "market", "review", "createdAt")
SELECT gen_random_uuid(), r."id", r."keywords",
  coalesce(
    CASE WHEN t."error" IS NOT NULL THEN jsonb_build_object('error', t."error") ELSE t."data" END,
    '{}'::jsonb),
  coalesce(
    CASE WHEN m."error" IS NOT NULL THEN jsonb_build_object('error', m."error") ELSE m."data" END,
    '{}'::jsonb),
  v."data",
  coalesce(r."refreshedAt", t."fetchedAt", m."fetchedAt", r."createdAt")
FROM "research" r
LEFT JOIN "research_snapshot" t ON t."researchId" = r."id" AND t."source" = 'pinterest_trends'
LEFT JOIN "research_snapshot" m ON m."researchId" = r."id" AND m."source" = 'etsy_market'
LEFT JOIN "research_snapshot" v ON v."researchId" = r."id" AND v."source" = 'pool_review'
WHERE t."id" IS NOT NULL OR m."id" IS NOT NULL;

DELETE FROM "research_snapshot" WHERE "source" IN ('pinterest_trends', 'etsy_market', 'pool_review');
