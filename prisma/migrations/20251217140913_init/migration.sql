-- CreateTable
CREATE TABLE "User" (
    "user_id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "profile_name" VARCHAR(255),
    "password" VARCHAR(255) NOT NULL,
    "salt" VARCHAR(255) NOT NULL,
    "age" INTEGER,
    "gender" VARCHAR(10),
    "login_type" VARCHAR(50) NOT NULL DEFAULT 'local',
    "profile_picture" TEXT,
    "kakao_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "Diary" (
    "diary_id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "color" VARCHAR(50) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diary_pkey" PRIMARY KEY ("diary_id")
);

-- CreateTable
CREATE TABLE "MoodMeter" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "color" VARCHAR(50) NOT NULL,
    "pleasantness" INTEGER NOT NULL,
    "energy" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmotionAnalysis" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "diary_id" INTEGER NOT NULL,
    "emotion_result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmotionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_kakao_id_key" ON "User"("kakao_id");

-- CreateIndex
CREATE INDEX "Diary_user_id_idx" ON "Diary"("user_id");

-- CreateIndex
CREATE INDEX "MoodMeter_user_id_idx" ON "MoodMeter"("user_id");

-- CreateIndex
CREATE INDEX "EmotionAnalysis_user_id_idx" ON "EmotionAnalysis"("user_id");

-- CreateIndex
CREATE INDEX "EmotionAnalysis_diary_id_idx" ON "EmotionAnalysis"("diary_id");

-- AddForeignKey
ALTER TABLE "Diary" ADD CONSTRAINT "Diary_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodMeter" ADD CONSTRAINT "MoodMeter_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionAnalysis" ADD CONSTRAINT "EmotionAnalysis_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmotionAnalysis" ADD CONSTRAINT "EmotionAnalysis_diary_id_fkey" FOREIGN KEY ("diary_id") REFERENCES "Diary"("diary_id") ON DELETE CASCADE ON UPDATE CASCADE;
