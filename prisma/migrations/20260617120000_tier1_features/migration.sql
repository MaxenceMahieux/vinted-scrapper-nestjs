-- AlterTable Listing: prix effectif, etat, favori
ALTER TABLE "Listing"
    ADD COLUMN "totalPrice" DECIMAL(10,2),
    ADD COLUMN "condition" TEXT,
    ADD COLUMN "statusId" INTEGER,
    ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable PriceObservation: etat pour stats par condition
ALTER TABLE "PriceObservation"
    ADD COLUMN "statusId" INTEGER NOT NULL DEFAULT 0;

-- AlterTable PriceStat: cle composite (modelKey, statusId)
ALTER TABLE "PriceStat"
    ADD COLUMN "statusId" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PriceStat" DROP CONSTRAINT "PriceStat_pkey";
ALTER TABLE "PriceStat" ADD CONSTRAINT "PriceStat_pkey" PRIMARY KEY ("modelKey", "statusId");

-- CreateTable TrackedItem
CREATE TABLE "TrackedItem" (
    "id" TEXT NOT NULL,
    "vintedItemId" BIGINT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "photoUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "country" TEXT NOT NULL DEFAULT 'fr',
    "initialPrice" DECIMAL(10,2) NOT NULL,
    "lastPrice" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "TrackedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedItem_vintedItemId_key" ON "TrackedItem"("vintedItemId");

-- CreateIndex
CREATE INDEX "TrackedItem_active_idx" ON "TrackedItem"("active");

-- CreateTable MutedSeller
CREATE TABLE "MutedSeller" (
    "sellerLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutedSeller_pkey" PRIMARY KEY ("sellerLogin")
);
