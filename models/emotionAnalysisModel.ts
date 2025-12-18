import prisma from "../db";
import { EmotionAnalysis } from "@prisma/client";

type Callback<T> = (error: Error | null, result?: T) => void;

interface AnalysisData {
  user_id: number;
  diary_id: number;
  emotion_result: string;
}

export const saveEmotionAnalysis = async (
  analysisData: AnalysisData,
  callback: Callback<EmotionAnalysis>
): Promise<void> => {
  try {
    const { user_id, diary_id, emotion_result } = analysisData;

    const result = await prisma.emotionAnalysis.create({
      data: {
        user_id: parseInt(String(user_id)),
        diary_id: parseInt(String(diary_id)),
        emotion_result,
      },
    });

    callback(null, result);
  } catch (error) {
    console.error("Save emotion analysis error:", error);
    callback(error as Error, undefined);
  }
};

export const getEmotionAnalysisByDiaryId = async (
  diary_id: number,
  callback: Callback<string | null>
): Promise<void> => {
  try {
    const result = await prisma.emotionAnalysis.findFirst({
      where: { diary_id: parseInt(String(diary_id)) },
      select: { emotion_result: true },
    });

    if (result) {
      callback(null, result.emotion_result);
    } else {
      callback(null, null);
    }
  } catch (error) {
    console.error("Get emotion analysis error:", error);
    callback(error as Error, undefined);
  }
};

export const countEmotionAnalysisByUserId = async (
  user_id: number,
  callback: Callback<number>
): Promise<void> => {
  try {
    const totalEmotionResults = await prisma.emotionAnalysis.count({
      where: { user_id: parseInt(String(user_id)) },
    });

    callback(null, totalEmotionResults);
  } catch (error) {
    console.error("Count emotion analysis error:", error);
    callback(error as Error, undefined);
  }
};
