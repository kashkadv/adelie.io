-- Where a post leads (Pinterest pin link) and the product it points to, e.g. "etsy:123" (ADR-0018).
ALTER TABLE "social_post" ADD COLUMN "link" TEXT,
ADD COLUMN "linkKey" TEXT;

CREATE INDEX "social_post_projectId_linkKey_idx" ON "social_post"("projectId", "linkKey");
