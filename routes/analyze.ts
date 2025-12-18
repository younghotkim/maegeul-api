import express from "express";
import { analyzeEmotion } from "../controllers/analyzeController";

const router = express.Router();

router.post("/", analyzeEmotion);

export default router;
