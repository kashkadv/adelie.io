-- CreateTable
CREATE TABLE "user_profile" (
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "avatar" BYTEA,
    "avatarMime" TEXT,
    "avatarUpdatedAt" TIMESTAMP(3),
    "contactEmail" TEXT,
    "phone" TEXT,
    "telegram" TEXT,
    "whatsapp" TEXT,
    "viber" TEXT,
    "linkedin" TEXT,
    "timezone" TEXT,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "workStart" TEXT,
    "workEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

