import express from "express";
import {
  createEmotionAnalysis,
  getEmotionAnalysis,
  getEmotionAnalysisCount,
} from "../controllers/emotionAnalysisController";

const router = express.Router();

router.post("/emotion", createEmotionAnalysis);
router.get("/emotion/:diary_id", getEmotionAnalysis);
router.get("/emotion/user/:user_id/count", getEmotionAnalysisCount);

export default router;
