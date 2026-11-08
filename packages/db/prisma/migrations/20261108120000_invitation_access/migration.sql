-- Connection access level chosen with the invitation (ADR-0019).
ALTER TABLE "connect_invitation" ADD COLUMN "access" TEXT NOT NULL DEFAULT 'read';
