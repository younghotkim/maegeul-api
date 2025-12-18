import express, { Request, Response } from "express";
import * as userController from "../controllers/userController";
import multer from "multer";
import path from "path";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

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
      res
        .status(500)
        .json({ message: "Internal server error", error: err });
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
