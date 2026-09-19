/*
  Warnings:

  - The primary key for the `Shape` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[id]` on the table `Shape` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Shape" DROP CONSTRAINT "Shape_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT;
DROP SEQUENCE "Shape_id_seq";

-- CreateIndex
CREATE UNIQUE INDEX "Shape_id_key" ON "public"."Shape"("id");
