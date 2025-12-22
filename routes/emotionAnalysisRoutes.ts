import express from "express";
import {
  createEmotionAnalysis,
  getEmotionAnalysis,
  getEmotionAnalysisCount,
} from "../controllers/emotionAnalysisController";
import { authenticateToken, verifyUserOwnership } from "../middleware/auth";

const router = express.Router();

// All emotion analysis routes require authentication
router.post("/emotion", authenticateToken, createEmotionAnalysis);
router.get("/emotion/:diary_id", authenticateToken, getEmotionAnalysis);
router.get(
  "/emotion/user/:user_id/count",
  authenticateToken,
  verifyUserOwnership,
  getEmotionAnalysisCount
);

export default router;
