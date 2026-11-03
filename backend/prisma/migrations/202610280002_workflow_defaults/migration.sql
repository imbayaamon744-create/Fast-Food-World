-- Defaults affect future inserts only; no historical pending order is accepted.
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';
ALTER TABLE "CateringRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "OrderStatusHistory" ADD COLUMN "reason" VARCHAR(1000);
