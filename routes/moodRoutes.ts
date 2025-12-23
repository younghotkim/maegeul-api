import express from "express";
import {
  createMoodMeter,
  getMoodMeterForUser,
  getColorKeywordCount,
  getLabelForUser,
  getRecentMoodColors,
} from "../controllers/moodController";
import { authenticateToken, verifyUserOwnership } from "../middleware/auth";

const router = express.Router();

// All mood routes require authentication
router.post("/save-moodmeter", authenticateToken, createMoodMeter);
router.get(
  "/moodmeter/user/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getMoodMeterForUser
);
router.get(
  "/moodmeter/colorcount/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getColorKeywordCount
);
router.get(
  "/moodmeter/color/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getRecentMoodColors
);
router.get(
  "/moodmeter/label/:user_id",
  authenticateToken,
  verifyUserOwnership,
  getLabelForUser
);

export default router;
