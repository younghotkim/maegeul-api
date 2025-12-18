import { Request, Response } from "express";
import {
  saveMoodMeter,
  getMoodMeterByUserId,
  getColorKeywordCountByUserId,
  getLabelByUserId,
} from "../models/moodModel";

export const createMoodMeter = (req: Request, res: Response): void => {
  const moodData = req.body;

  if (!moodData.user_id || !moodData.pleasantness || !moodData.energy) {
    res.status(400).json({ error: "필수 데이터가 누락되었습니다." });
    return;
  }

  saveMoodMeter(moodData, (err, result) => {
    if (err) {
      console.error("DB 저장 중 오류 발생:", err);
      res.status(500).json({ error: "DB 저장 중 오류 발생" });
      return;
    }

    res.status(200).json({
      message: "MoodMeter 데이터가 성공적으로 저장되었습니다",
      id: result?.id,
    });
  });
};

export const getMoodMeterForUser = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  getMoodMeterByUserId(parseInt(user_id), (err, result) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    if (result && result.length === 0) {
      res.status(404).json({ message: "해당 사용자의 데이터가 없습니다." });
      return;
    }

    res.status(200).json(result);
  });
};

export const getLabelForUser = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  getLabelByUserId(parseInt(user_id), (err, result) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    if (result && result.length === 0) {
      res.status(404).json({ message: "해당 사용자의 데이터가 없습니다." });
      return;
    }

    res.status(200).json(result);
  });
};

export const getColorKeywordCount = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  getColorKeywordCountByUserId(parseInt(user_id), (err, result) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    res.status(200).json(result);
  });
};
