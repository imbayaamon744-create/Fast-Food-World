-- Additive only. Keep all historical statuses, quotes, totals and history unchanged.
ALTER TYPE "CateringStatus" ADD VALUE 'PENDING';
ALTER TYPE "CateringStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "CateringStatus" ADD VALUE 'DECLINED';
-- Commit enum additions before using PENDING as a default in PostgreSQL.
