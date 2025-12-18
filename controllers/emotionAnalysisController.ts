import { Request, Response } from "express";
import {
  saveEmotionAnalysis,
  getEmotionAnalysisByDiaryId,
  countEmotionAnalysisByUserId,
} from "../models/emotionAnalysisModel";

export const createEmotionAnalysis = (req: Request, res: Response): void => {
  const { user_id, diary_id, emotion_result } = req.body;

  if (!user_id || !diary_id || !emotion_result) {
    res.status(400).json({ error: "필수 데이터가 누락되었습니다." });
    return;
  }

  saveEmotionAnalysis({ user_id, diary_id, emotion_result }, (err, result) => {
    if (err) {
      console.error("DB 저장 중 오류 발생:", err);
      res.status(500).json({ error: "DB 저장 중 오류 발생" });
      return;
    }
    res.status(200).json({ message: "감정 분석 결과가 저장되었습니다." });
  });
};

export const getEmotionAnalysis = (req: Request, res: Response): void => {
  const { diary_id } = req.params;

  if (!diary_id) {
    res.status(400).json({ error: "diary_id가 누락되었습니다." });
    return;
  }

  getEmotionAnalysisByDiaryId(parseInt(diary_id), (err, emotionReport) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    if (!emotionReport) {
      res.status(404).json({ message: "감정 분석 결과가 없습니다." });
      return;
    }

    res.status(200).json({ emotionReport });
  });
};

export const getEmotionAnalysisCount = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  countEmotionAnalysisByUserId(parseInt(user_id), (err, count) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    res.status(200).json({ totalEmotionResults: count });
  });
};
