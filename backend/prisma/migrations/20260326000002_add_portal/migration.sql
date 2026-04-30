-- Add portal field to DqaSnapshot
ALTER TABLE "DqaSnapshot" ADD COLUMN "portal" TEXT NOT NULL DEFAULT 'HMIS';
