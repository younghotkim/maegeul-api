import express from "express";
import multer from "multer";
import path from "path";
import { uploadFile } from "../controllers/uploadController";

const router = express.Router();

const isProduction = process.env.NODE_ENV === "production";
const uploadPath = isProduction
  ? "/home/ec2-user/maegeul/server/uploads"
  : path.join(__dirname, "../uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const fileName = `${Date.now()}-${file.originalname}`;
    cb(null, fileName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.post("/upload", upload.single("profile_picture"), uploadFile);

export default router;
