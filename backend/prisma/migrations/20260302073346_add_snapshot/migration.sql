/*
  Warnings:

  - You are about to drop the column `uploadedById` on the `DqaSnapshot` table. All the data in the column will be lost.
  - You are about to drop the `UploadLog` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `userId` to the `DqaSnapshot` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "DqaSnapshot" DROP CONSTRAINT "DqaSnapshot_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "UploadLog" DROP CONSTRAINT "UploadLog_userId_fkey";

-- AlterTable
ALTER TABLE "DqaSnapshot" DROP COLUMN "uploadedById",
ADD COLUMN     "userId" TEXT NOT NULL;

-- DropTable
DROP TABLE "UploadLog";

-- DropEnum
DROP TYPE "UploadStatus";

-- AddForeignKey
ALTER TABLE "DqaSnapshot" ADD CONSTRAINT "DqaSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
