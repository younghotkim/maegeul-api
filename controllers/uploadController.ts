import { Request, Response } from "express";
import { put } from "@vercel/blob";

export const uploadFile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "파일이 업로드되지 않았습니다." });
      return;
    }

    // Vercel Blob Storage에 업로드
    const blob = await put(
      `profile-pictures/${Date.now()}-${req.file.originalname}`,
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
    res
      .status(500)
      .json({ message: "파일 업로드 중 오류가 발생했습니다.", error });
  }
};
