-- CreateSchema
-- Use the schema selected by DATABASE_URL; do not modify an unrelated schema.

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CateringStatus" AS ENUM ('REQUESTED', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" VARCHAR(1000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "categoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantSettings" (
    "id" TEXT NOT NULL DEFAULT 'restaurant',
    "name" VARCHAR(120) NOT NULL DEFAULT 'Fast Food Restaurant',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Africa/Nairobi',
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 15000,
    "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "address" VARCHAR(400) NOT NULL,
    "phone" VARCHAR(40),
    "email" VARCHAR(254),
    "openingHours" VARCHAR(300) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "idempotencyHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "trackingTokenHash" VARCHAR(64) NOT NULL,
    "customerName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "deliveryAddress" VARCHAR(400),
    "notes" VARCHAR(1000),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "subtotalMinor" INTEGER NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "adminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CateringRequest" (
    "id" UUID NOT NULL,
    "idempotencyHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "customerName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "eventDate" DATE NOT NULL,
    "location" VARCHAR(400) NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "package" VARCHAR(30) NOT NULL,
    "eventDetails" VARCHAR(2000),
    "status" "CateringStatus" NOT NULL DEFAULT 'REQUESTED',
    "adminNotes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CateringRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" VARCHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_slug_key" ON "MenuItem"("slug");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_available_idx" ON "MenuItem"("categoryId", "available");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyHash_key" ON "Order"("idempotencyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingTokenHash_key" ON "Order"("trackingTokenHash");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_menuItemId_key" ON "OrderItem"("orderId", "menuItemId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CateringRequest_idempotencyHash_key" ON "CateringRequest"("idempotencyHash");

-- CreateIndex
CREATE INDEX "CateringRequest_status_createdAt_idx" ON "CateringRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "sessions_expire_idx" ON "sessions"("expire");

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense in depth: preserve money, quantity and fulfilment invariants in PostgreSQL.
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_price_check" CHECK ("priceMinor" BETWEEN 0 AND 1000000);
ALTER TABLE "RestaurantSettings" ADD CONSTRAINT "RestaurantSettings_values_check"
  CHECK ("id" = 'restaurant' AND "currency" = 'KES' AND "timezone" = 'Africa/Nairobi' AND "deliveryFeeMinor" BETWEEN 0 AND 1000000);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_values_check"
  CHECK ("quantity" BETWEEN 1 AND 20 AND "unitPriceMinor" BETWEEN 0 AND 1000000 AND "lineTotalMinor" = "unitPriceMinor" * "quantity");
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_check"
  CHECK ("currency" = 'KES' AND "subtotalMinor" BETWEEN 0 AND 1000000000 AND "deliveryFeeMinor" BETWEEN 0 AND 1000000
    AND "totalMinor" = "subtotalMinor" + "deliveryFeeMinor");
ALTER TABLE "Order" ADD CONSTRAINT "Order_fulfilment_check"
  CHECK (("fulfilment" = 'PICKUP' AND "deliveryAddress" IS NULL AND "deliveryFeeMinor" = 0 AND "status" <> 'OUT_FOR_DELIVERY')
    OR ("fulfilment" = 'DELIVERY' AND "deliveryAddress" IS NOT NULL AND length(trim("deliveryAddress")) > 0));
ALTER TABLE "CateringRequest" ADD CONSTRAINT "CateringRequest_values_check"
  CHECK ("guestCount" BETWEEN 1 AND 10000 AND "package" IN ('Classic', 'Premium', 'Deluxe'));

