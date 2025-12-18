import express from "express";
import {
  createDiary,
  getUserDiaries,
  getDiaryCountByUser,
  getConsecutiveDaysByUser,
  deleteDiary,
} from "../controllers/diaryController";

const router = express.Router();

router.post("/diary", createDiary);
router.get("/diary/:user_id", getUserDiaries);
router.get("/diary/count/:user_id", getDiaryCountByUser);
router.get("/diary/consecutive/:user_id", getConsecutiveDaysByUser);
router.delete("/diary/delete/:diary_id", deleteDiary);

export default router;
