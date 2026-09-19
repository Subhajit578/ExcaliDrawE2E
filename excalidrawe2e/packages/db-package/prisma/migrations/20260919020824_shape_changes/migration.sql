-- AlterTable
ALTER TABLE "public"."Shape" ADD CONSTRAINT "Shape_pkey" PRIMARY KEY ("id");

-- DropIndex
DROP INDEX "public"."Shape_id_key";
