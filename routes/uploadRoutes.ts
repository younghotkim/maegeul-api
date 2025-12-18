import express from "express";
import multer from "multer";
import { uploadFile } from "../controllers/uploadController";

const router = express.Router();

// Vercel Blob Storage 사용을 위해 memory storage 사용
// 파일을 메모리에 저장한 후 Blob에 업로드
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
});

router.post("/upload", upload.single("profile_picture"), uploadFile);

export default router;
