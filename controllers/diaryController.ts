import { Request, Response } from "express";
import {
  saveDiary,
  getDiariesByUserId,
  countDiariesByUserId,
  getConsecutiveDaysByUserId,
  deleteDiaryById,
} from "../models/diaryModel";
import { getUserPasswordAndSalt } from "../models/user";
import { encrypt, generateEncryptionKey } from "../util/encrypt";
import { upsertDiaryEmbedding, deleteDiaryEmbedding } from "../services/embedding.service";

/**
 * Generates embedding for a diary entry asynchronously (non-blocking)
 * Handles failures gracefully without affecting the main diary creation flow
 * @param diaryId - The ID of the diary to generate embedding for
 * @param content - The diary content to embed
 */
async function generateEmbeddingAsync(diaryId: number, content: string): Promise<void> {
  try {
    await upsertDiaryEmbedding(diaryId, content);
    console.log(`Embedding generated successfully for diary ${diaryId}`);
  } catch (error) {
    // Log the error but don't throw - embedding generation should not block diary creation
    console.error(`Failed to generate embedding for diary ${diaryId}:`, error);
    // The embedding can be regenerated later if needed
  }
}

/**
 * Cleans up embedding for a diary entry as a fallback
 * Note: CASCADE delete should handle this automatically, but this provides explicit cleanup
 * Validates: Requirements 6.3
 * @param diaryId - The ID of the diary whose embedding should be deleted
 */
async function cleanupEmbeddingAsync(diaryId: number): Promise<void> {
  try {
    await deleteDiaryEmbedding(diaryId);
    console.log(`Embedding cleanup completed for diary ${diaryId}`);
  } catch (error) {
    // Log but don't throw - CASCADE should have already handled this
    console.warn(`Embedding cleanup for diary ${diaryId} (may already be deleted by CASCADE):`, error);
  }
}

export const createDiary = (req: Request, res: Response): void => {
  const { user_id, title, content, color } = req.body;

  getUserPasswordAndSalt(user_id, (err, user) => {
    if (err) {
      console.error("사용자의 비밀번호 및 salt 가져오는 중 오류 발생:", err);
      res.status(500).json({
        error: "사용자의 비밀번호 및 salt를 가져오는 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!user || !user.password || !user.salt) {
      console.error("비밀번호 또는 Salt 값이 정의되지 않았습니다.");
      res.status(500).json({
        error: "비밀번호 또는 Salt 값이 정의되지 않았습니다.",
      });
      return;
    }

    const encryptionKey = generateEncryptionKey(user.password, user.salt);
    const encryptedContent = encrypt(content, encryptionKey);

    saveDiary({ user_id, title, encryptedContent, color }, (err, result) => {
      if (err) {
        res
          .status(500)
          .json({ error: "DB 저장 중 오류가 발생했습니다." });
        return;
      }
      
      // Trigger async embedding generation (non-blocking)
      // Uses original unencrypted content for semantic search
      // Validates: Requirements 4.1 - Generate embedding within 30 seconds
      if (result?.diary_id) {
        generateEmbeddingAsync(result.diary_id, content);
      }
      
      res.status(200).json({
        message: "일기가 저장되었습니다.",
        diary_id: result.diary_id,
      });
      console.log("암호화 일기 저장 성공!");
    });
  });
};

export const getUserDiaries = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  getUserPasswordAndSalt(parseInt(user_id), (err, user) => {
    if (err) {
      console.error("사용자의 비밀번호 및 salt 가져오는 중 오류 발생:", err);
      res.status(500).json({
        error: "사용자의 비밀번호 및 salt를 가져오는 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!user || !user.password || !user.salt) {
      console.error("비밀번호 또는 Salt 값이 정의되지 않았습니다.");
      res.status(500).json({
        error: "비밀번호 또는 Salt 값이 정의되지 않았습니다.",
      });
      return;
    }

    const encryptionKey = generateEncryptionKey(user.password, user.salt);

    getDiariesByUserId(parseInt(user_id), encryptionKey, (err, diaries) => {
      if (err) {
        console.error("DB 조회 중 오류 발생:", err);
        res.status(500).json({ error: "DB 조회 중 오류 발생" });
        return;
      }

      if (diaries && diaries.length === 0) {
        res.status(404).json({ message: "일기가 없습니다." });
        return;
      }

      res.status(200).json(diaries);
    });
  });
};

export const getDiaryCountByUser = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  countDiariesByUserId(parseInt(user_id), (err, count) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    res.status(200).json({ totalDiaries: count });
  });
};

export const getConsecutiveDaysByUser = (
  req: Request,
  res: Response
): void => {
  const { user_id } = req.params;

  if (!user_id) {
    res.status(400).json({ error: "user_id가 누락되었습니다." });
    return;
  }

  getConsecutiveDaysByUserId(parseInt(user_id), (err, result) => {
    if (err) {
      console.error("DB 조회 중 오류 발생:", err);
      res.status(500).json({ error: "DB 조회 중 오류 발생" });
      return;
    }

    res.status(200).json(result);
  });
};

export const deleteDiary = (req: Request, res: Response): void => {
  const { diary_id } = req.params;

  if (!diary_id) {
    res.status(400).json({ error: "Diary ID is required" });
    return;
  }

  const diaryIdNum = parseInt(diary_id);

  // Attempt manual embedding cleanup as fallback before diary deletion
  // Note: CASCADE delete should handle this automatically, but this ensures cleanup
  // Validates: Requirements 6.3
  cleanupEmbeddingAsync(diaryIdNum);

  deleteDiaryById(diaryIdNum, (err, result) => {
    if (err) {
      res.status(500).json({ error: "Failed to delete diary" });
      return;
    }

    res.status(200).json({ message: "Diary deleted successfully" });
  });
};
