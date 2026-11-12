-- What a site measures (ADR-0026): kind, goals, funnel. Every existing site was a shop:
-- it keeps the shop's purchase goal, so its cabinet looks as before.
ALTER TABLE "tracked_site" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'store',
ADD COLUMN "goals" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "funnel" JSONB;

UPDATE "tracked_site"
SET "goals" = '[{"id": "purchase", "rule": {"type": "event", "event": "Purchase"}, "valued": true}]';
