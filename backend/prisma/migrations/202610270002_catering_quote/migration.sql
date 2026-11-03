-- Additive only: existing requests and restaurant data remain unchanged.
ALTER TABLE "CateringRequest" ADD COLUMN "quoteMinor" INTEGER;
ALTER TABLE "CateringRequest" ADD CONSTRAINT "CateringRequest_quote_check"
  CHECK ("quoteMinor" IS NULL OR "quoteMinor" BETWEEN 0 AND 1000000000);
