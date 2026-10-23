-- CreateEnum
CREATE TYPE "SaathiCheckInTime" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'BEFORE_BED', 'ONLY_WHEN_I_OPEN');

-- CreateEnum
CREATE TYPE "SaathiLanguage" AS ENUM ('HINDI', 'ENGLISH', 'HINGLISH');

-- CreateEnum
CREATE TYPE "UnwindHabit" AS ENUM ('BREATHING', 'WALKING', 'TALKING_IT_OUT', 'CALM_SOUNDS', 'WRITING', 'AYURVEDA_ROUTINES');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "saathiCheckIn" "SaathiCheckInTime" NOT NULL DEFAULT 'ONLY_WHEN_I_OPEN',
ADD COLUMN     "saathiLanguage" "SaathiLanguage" NOT NULL DEFAULT 'ENGLISH',
ADD COLUMN     "unwindHabits" "UnwindHabit"[] DEFAULT ARRAY[]::"UnwindHabit"[];

ALTER TABLE "User" ALTER COLUMN "saathiCheckIn" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "saathiLanguage" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "unwindHabits" DROP DEFAULT;
