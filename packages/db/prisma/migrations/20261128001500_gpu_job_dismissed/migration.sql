-- The owner closed a failed job's message on the location page.
ALTER TABLE "gpu_job" ADD COLUMN "dismissedAt" TIMESTAMP(3);
