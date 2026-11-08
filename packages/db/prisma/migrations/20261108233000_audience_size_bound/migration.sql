-- Audience size can be a ceiling ("up to 10k") rather than an estimate.
ALTER TABLE "account_audience" ADD COLUMN "sizeIsUpperBound" BOOLEAN NOT NULL DEFAULT false;
