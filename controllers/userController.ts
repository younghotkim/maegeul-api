import { Request, Response } from "express";
import * as userModel from "../models/user";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { put } from "@vercel/blob";

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      email,
      password,
      salt,
      username,
      profile_name,
      age,
      gender,
      birthdate,
    } = req.body;

    if (!email || !password || !username) {
      res.status(400).json({ message: "필수 항목이 누락되었습니다." });
      return;
    }

    // 프로필 사진이 업로드된 경우 Vercel Blob에 저장
    let profile_picture = req.body.profile_picture || null;

    if (req.file) {
      try {
        const blob = await put(
          `profile-pictures/${Date.now()}-${req.file.originalname}`,
          req.file.buffer,
          {
            access: "public",
            contentType: req.file.mimetype,
          }
        );
        profile_picture = blob.url;
      } catch (blobError) {
        console.error("프로필 사진 업로드 오류:", blobError);
        // Blob 업로드 실패해도 회원가입은 진행 (프로필 사진 없이)
      }
    }

    const userData = {
      email,
      password,
      salt,
      username,
      profile_name,
      age,
      gender,
      birthdate,
      profile_picture,
    };

    userModel.insertUser(userData, (err, userId) => {
      if (err) {
        res.status(500).json({ message: "DB 저장 중 오류 발생", error: err });
        return;
      }
      res.status(201).json({ message: "회원가입 성공", userId });
    });
  } catch (error) {
    res.status(500).json({ message: "회원가입 중 오류 발생", error });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  console.log(req.body);

  userModel.select(email, password, async (err, user) => {
    console.log(user);

    if (err) {
      console.error("Database error:", err);
      res.status(500).json({ message: "서버 오류" });
      return;
    }

    if (!user) {
      res
        .status(401)
        .json({ message: "이메일 또는 비밀번호가 잘못되었습니다." });
      return;
    }

    const token = jwt.sign(
      { userId: user.user_id, profileName: user.profile_name },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    console.log("로그인 성공: ", user.profile_name, user.user_id);

    res.status(200).json({
      message: "로그인 성공",
      token,
      user: {
        user_id: user.user_id,
        profile_name: user.profile_name,
        email: user.email,
        profile_picture: user.profile_picture,
      },
    });
  });
};

export const getUser = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  userModel.get_user(parseInt(user_id), (err, user) => {
    if (err) {
      res.status(500).json({
        message: "회원 정보를 가져오는 중 오류가 발생했습니다.",
        error: err,
      });
      return;
    }

    if (!user) {
      res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
      return;
    }

    res.status(200).json({
      message: "회원 정보 조회 성공",
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        profile_name: user.profile_name,
        profile_picture: user.profile_picture,
      },
    });
  });
};

export const updateUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    user_id,
    username,
    email,
    profile_name,
    password,
    age,
    gender,
    login_type,
    profile_picture,
  } = req.body;

  if (!user_id) {
    res.status(400).json({ message: "사용자 ID가 필요합니다." });
    return;
  }

  let updatedPassword = null;
  let salt = null;

  if (password) {
    salt = crypto.randomBytes(16).toString("hex");
    updatedPassword = await bcrypt.hash(password + salt, 10);
  }

  const userData = {
    user_id,
    username,
    email,
    profile_name,
    password: updatedPassword || password,
    salt: salt || null,
    age,
    gender,
    login_type,
    profile_picture,
  };

  userModel.update(userData, (err, result) => {
    if (err) {
      res.status(500).json({
        message: "회원 정보 수정 중 오류가 발생했습니다.",
        error: err,
      });
      return;
    }

    res.status(200).json({ message: "회원 정보 수정 성공", result });
  });
};

export const deleteUser = (req: Request, res: Response): void => {
  const { user_id } = req.params;

  userModel.deleteUser(parseInt(user_id), (err, result) => {
    if (err) {
      res.status(500).json({
        message: "회원 탈퇴 중 오류가 발생했습니다.",
        error: err,
      });
      return;
    }

    res.status(200).json({ message: "회원 탈퇴 성공", result });
  });
};

export const checkDuplicateEmail = (
  email: string,
  callback: (error: Error | null, isDuplicate?: boolean) => void = () => {}
): void => {
  userModel.findByEmail(email, (err, user) => {
    if (err) {
      return callback(err, undefined);
    }
    if (user) {
      return callback(null, true);
    }
    return callback(null, false);
  });
};
