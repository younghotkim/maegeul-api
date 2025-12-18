import express from "express";
import {
  createMoodMeter,
  getMoodMeterForUser,
  getColorKeywordCount,
  getLabelForUser,
} from "../controllers/moodController";

const router = express.Router();

router.post("/save-moodmeter", createMoodMeter);
router.get("/moodmeter/user/:user_id", getMoodMeterForUser);
router.get("/moodmeter/colorcount/:user_id", getColorKeywordCount);
router.get("/moodmeter/label/:user_id", getLabelForUser);

export default router;
