import express from "express";
import {
  createDiary,
  getUserDiaries,
  getDiaryCountByUser,
  getConsecutiveDaysByUser,
  deleteDiary,
} from "../controllers/diaryController";
import { authenticateToken, verifyUserOwnership } from "../middleware/auth";

const router = express.Router();

// All diary routes require authentication
router.post("/diary", authenticateToken, createDiary);
router.get(
  "/diary/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getUserDiaries
);
router.get(
  "/diary/count/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getDiaryCountByUser
);
router.get(
  "/diary/consecutive/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getConsecutiveDaysByUser
);
router.delete("/diary/delete/:diary_id", authenticateToken, deleteDiary);

export default router;
