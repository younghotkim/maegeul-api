import express from "express";
import { analyzeEmotion } from "../controllers/analyzeController";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

// Emotion analysis requires authentication (uses OpenAI API)
router.post("/", authenticateToken, analyzeEmotion);

export default router;
