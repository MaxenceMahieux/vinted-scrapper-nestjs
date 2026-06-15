-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "searchText" TEXT,
    "catalogIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "brandIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "priceFrom" DECIMAL(10,2),
    "priceTo" DECIMAL(10,2),
    "order" TEXT NOT NULL DEFAULT 'newest_first',
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "vintedItemId" BIGINT NOT NULL,
    "searchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "url" TEXT NOT NULL,
    "photoUrl" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "sellerLogin" TEXT,
    "publishedAt" TIMESTAMP(3),
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedSearch_enabled_idx" ON "SavedSearch"("enabled");

-- CreateIndex
CREATE INDEX "Listing_notified_idx" ON "Listing"("notified");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_searchId_vintedItemId_key" ON "Listing"("searchId", "vintedItemId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

