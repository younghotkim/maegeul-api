import express, { Request, Response } from "express";
import * as userController from "../controllers/userController";
import multer from "multer";

const router = express.Router();

// Vercel Blob Storage 사용을 위해 memory storage 사용
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
});

router.post(
  "/register",
  upload.single("profile_picture"),
  userController.register
);

router.post("/login", userController.login);
router.get("/user/:user_id", userController.getUser);
router.put("/user", userController.updateUser);
router.delete("/user/:user_id", userController.deleteUser);

router.post("/check-email", (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ message: "Email is required" });
    return;
  }

  userController.checkDuplicateEmail(email, (err, isDuplicate) => {
    if (err) {
      res.status(500).json({ message: "Internal server error", error: err });
      return;
    }

    if (isDuplicate) {
      res.status(409).json({ message: "Email already exists" });
      return;
    }

    res.status(200).json({ message: "Email is available" });
  });
});

export default router;
