-- Links of a post: its own link and URLs in its text (ADR-0018). Replaces social_post.linkKey;
-- the next sync fills the table for every post.
CREATE TABLE "social_post_link" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "social_post_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_post_link_postId_key_key" ON "social_post_link"("postId", "key");
CREATE INDEX "social_post_link_projectId_key_idx" ON "social_post_link"("projectId", "key");

ALTER TABLE "social_post_link" ADD CONSTRAINT "social_post_link_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "social_post_projectId_linkKey_idx";
ALTER TABLE "social_post" DROP COLUMN "linkKey";
