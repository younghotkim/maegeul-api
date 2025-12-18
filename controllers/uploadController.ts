import { Request, Response } from "express";

export const uploadFile = (req: Request, res: Response): void => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "파일이 업로드되지 않았습니다." });
      return;
    }

    res.status(200).json({
      message: "파일이 성공적으로 업로드되었습니다.",
      filePath: `/uploads/${req.file.filename}`,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "파일 업로드 중 오류가 발생했습니다.", error });
  }
};
