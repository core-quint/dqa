-- CreateEnum
CREATE TYPE "UserLevel" AS ENUM ('NATIONAL', 'STATE', 'DISTRICT', 'BLOCK');

-- AlterTable User
ALTER TABLE "User" ADD COLUMN "level" "UserLevel" NOT NULL DEFAULT 'NATIONAL';
ALTER TABLE "User" ADD COLUMN "geoState" TEXT;
ALTER TABLE "User" ADD COLUMN "geoDistrict" TEXT;
ALTER TABLE "User" ADD COLUMN "geoBlock" TEXT;

-- CreateTable GeoEntry
CREATE TABLE "GeoEntry" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  CONSTRAINT "GeoEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeoEntry_state_district_block_key" UNIQUE ("state", "district", "block")
);
