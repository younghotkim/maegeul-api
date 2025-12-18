import prisma from "../db";
import { encrypt, decrypt, generateEncryptionKey } from "../util/encrypt";
import { Diary } from "@prisma/client";

type Callback<T> = (error: Error | null, result?: T) => void;

interface DiaryData {
  user_id: number;
  title: string;
  encryptedContent: string;
  color: string;
}

interface DiaryWithFormattedDate extends Diary {
  formatted_date: string;
}

interface ConsecutiveDaysResult {
  start_date: string;
  consecutive_days: number;
}

export const saveDiary = async (
  diaryData: DiaryData,
  callback: Callback<Diary>
): Promise<void> => {
  try {
    const { user_id, title, encryptedContent, color } = diaryData;

    const result = await prisma.diary.create({
      data: {
        user_id: parseInt(String(user_id)),
        title,
        content: encryptedContent,
        color,
      },
    });

    callback(null, result);
  } catch (error) {
    console.error("Save diary error:", error);
    callback(error as Error);
  }
};

export const getDiariesByUserId = async (
  user_id: number,
  encryptionKey: string,
  callback: Callback<DiaryWithFormattedDate[]>
): Promise<void> => {
  try {
    const diaries = await prisma.diary.findMany({
      where: { user_id: parseInt(String(user_id)) },
      orderBy: { date: "desc" },
      select: {
        diary_id: true,
        user_id: true,
        title: true,
        content: true,
        color: true,
        date: true,
      },
    });

    const decryptedDiaries = diaries.map((diary) => {
      let decryptedContent: string;
      try {
        decryptedContent = decrypt(diary.content, encryptionKey);
      } catch (error) {
        console.error("일기 복호화 중 오류 발생:", error);
        decryptedContent = "복호화 실패";
      }

      const date = new Date(diary.date);
      const formatted_date = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

      return {
        ...diary,
        content: decryptedContent,
        formatted_date,
      };
    });

    callback(null, decryptedDiaries);
  } catch (error) {
    console.error("Get diaries error:", error);
    callback(error as Error, undefined);
  }
};

export const countDiariesByUserId = async (
  user_id: number,
  callback: Callback<number>
): Promise<void> => {
  try {
    const totalDiaries = await prisma.diary.count({
      where: { user_id: parseInt(String(user_id)) },
    });

    callback(null, totalDiaries);
  } catch (error) {
    console.error("Count diaries error:", error);
    callback(error as Error, undefined);
  }
};

export const getConsecutiveDaysByUserId = async (
  user_id: number,
  callback: Callback<ConsecutiveDaysResult[]>
): Promise<void> => {
  try {
    const result = await prisma.$queryRaw<ConsecutiveDaysResult[]>`
      SELECT
        TO_CHAR(MIN(date), 'YYYY-MM-DD') AS start_date,
        EXTRACT(DAY FROM (MAX(date) - MIN(date))) + 1 AS consecutive_days
      FROM (
        SELECT date,
               ROW_NUMBER() OVER (ORDER BY date) -
               EXTRACT(DAY FROM (date - MIN(date) OVER (PARTITION BY user_id))) AS grp
        FROM "Diary"
        WHERE user_id = ${parseInt(String(user_id))}
      ) AS subquery
      GROUP BY grp
      ORDER BY start_date
    `;

    callback(null, result);
  } catch (error) {
    console.error("Get consecutive days error:", error);
    callback(error as Error, undefined);
  }
};

export const deleteDiaryById = async (
  diary_id: number,
  callback: Callback<Diary>
): Promise<void> => {
  try {
    const result = await prisma.diary.delete({
      where: { diary_id: parseInt(String(diary_id)) },
    });

    callback(null, result);
  } catch (error) {
    console.error("Delete diary error:", error);
    callback(error as Error);
  }
};
