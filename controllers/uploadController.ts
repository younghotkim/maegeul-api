import { Request, Response } from "express";
import { put } from "@vercel/blob";
import path from "path";

// 허용된 이미지 파일 타입
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

// 파일명 sanitization
const sanitizeFilename = (filename: string): string => {
  // 파일명에서 위험한 문자 제거
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_") // 경로 탐색 방지
    .substring(0, 255); // 파일명 길이 제한
};

export const uploadFile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "파일이 업로드되지 않았습니다." });
      return;
    }

    // 파일 타입 검증
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
      res.status(400).json({
        message: "허용되지 않는 파일 형식입니다. JPEG, PNG, GIF, WebP만 허용됩니다.",
      });
      return;
    }

    // 파일 크기 재검증 (10MB)
    if (req.file.size > 10 * 1024 * 1024) {
      res.status(400).json({
        message: "파일 크기는 10MB를 초과할 수 없습니다.",
      });
      return;
    }

    // 파일명 sanitization
    const sanitizedFilename = sanitizeFilename(req.file.originalname);
    const fileExtension = path.extname(sanitizedFilename);
    const baseFilename = path.basename(sanitizedFilename, fileExtension);

    // Vercel Blob Storage에 업로드
    const blob = await put(
      `profile-pictures/${Date.now()}-${baseFilename}${fileExtension}`,
      req.file.buffer,
      {
        access: "public",
        contentType: req.file.mimetype,
      }
    );

    res.status(200).json({
      message: "파일이 성공적으로 업로드되었습니다.",
      filePath: blob.url,
      blobUrl: blob.url,
    });
  } catch (error) {
    console.error("Vercel Blob 업로드 오류:", error);
    res.status(500).json({
      message: "파일 업로드 중 오류가 발생했습니다.",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
