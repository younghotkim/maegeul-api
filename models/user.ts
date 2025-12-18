import bcrypt from "bcrypt";
import prisma from "../db";
import {
  generateEncryptionKey,
  generateRandomSalt,
} from "../util/encrypt";
import crypto from "crypto";
import { User } from "@prisma/client";

type Callback<T> = (error: Error | null, result?: T) => void;

interface KakaoProfile {
  id: string;
  displayName: string;
  _json: {
    kakao_account: {
      email?: string;
    };
    properties: {
      profile_image?: string;
    };
  };
}

interface InsertUserData {
  username: string;
  email: string;
  profile_name: string;
  password: string;
  age?: number;
  gender?: string;
  login_type?: string;
  profile_picture?: string;
}

interface UpdateUserData {
  user_id: number;
  username: string;
  email: string;
  profile_name: string;
  password: string;
  age?: number;
  gender?: string;
  login_type: string;
  profile_picture?: string;
}

// 카카오 로그인 로직
export const handleKakaoLogin = async (
  profile: KakaoProfile,
  cb: Callback<User> = () => {}
): Promise<void> => {
  try {
    const kakaoId = profile.id;
    const email = profile._json.kakao_account.email;
    const nickname = profile.displayName;
    const profileImage = profile._json.properties.profile_image;

    // 기존 사용자 검색
    const existingKakaoUser = await prisma.user.findUnique({
      where: { kakao_id: String(kakaoId) },
    });

    console.log("카카오 로그인");

    if (existingKakaoUser) {
      return cb(null, existingKakaoUser);
    }

    // 새로운 사용자 생성
    const salt = generateRandomSalt();
    const encryptionKey = generateEncryptionKey(kakaoId, salt);

    const newUser = await prisma.user.create({
      data: {
        kakao_id: String(kakaoId),
        email: email || `kakao_${kakaoId}@example.com`,
        username: nickname || "카카오유저",
        password: String(kakaoId),
        profile_name: nickname,
        profile_picture: profileImage,
        login_type: "kakao",
        salt: salt,
      },
    });

    return cb(null, newUser);
  } catch (error) {
    console.error("Kakao login error:", error);
    return cb(error as Error);
  }
};

// 이메일로 사용자 찾기
export const findByEmail = async (
  email: string,
  callback: Callback<User | null>
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });
    return callback(null, user);
  } catch (error) {
    return callback(error as Error, null);
  }
};

// 카카오 ID로 사용자 찾기
export const findByKakaoId = async (
  kakaoId: string,
  callback: Callback<User | null> = () => {}
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { kakao_id: String(kakaoId) },
    });
    return callback(null, user);
  } catch (error) {
    return callback(error as Error, null);
  }
};

// 새로운 사용자 추가 (카카오)
export const insert = async (
  data: any,
  callback: Callback<number> = () => {}
): Promise<void> => {
  try {
    const newUser = await prisma.user.create({
      data: {
        kakao_id: data.kakao_id,
        email: data.email,
        profile_name: data.profile_name,
        password: data.password,
        username: data.username,
        login_type: data.login_type,
        profile_picture: data.profile_picture,
        salt: data.salt,
      },
    });
    return callback(null, newUser.user_id);
  } catch (error) {
    return callback(error as Error);
  }
};

// 회원가입 시 사용자 정보를 DB에 저장
export const insertUser = async (
  data: InsertUserData,
  cb: Callback<number> = () => {}
): Promise<void> => {
  try {
    // salt 생성
    const salt = crypto.randomBytes(16).toString("hex");
    // PBKDF2를 사용한 비밀번호 해싱
    const hashedPassword = crypto
      .pbkdf2Sync(data.password, salt, 10000, 64, "sha512")
      .toString("hex");

    const newUser = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        profile_name: data.profile_name,
        password: hashedPassword,
        salt: salt,
        age: data.age || null,
        gender: data.gender || null,
        login_type: data.login_type || "local",
        profile_picture: data.profile_picture || null,
      },
    });

    cb(null, newUser.user_id);
  } catch (error) {
    console.error("Insert user error:", error);
    cb(error as Error);
  }
};

// 로그인 (이메일 + 비밀번호)
export const select = async (
  email: string,
  password: string,
  cb: Callback<User | null> = () => {}
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return cb(null, null);
    }

    if (!user.salt) {
      return cb(new Error("Salt 값이 null입니다."));
    }

    // 저장된 salt를 사용해 입력된 비밀번호를 다시 해싱
    const hashedInputPassword = crypto
      .pbkdf2Sync(password, user.salt, 10000, 64, "sha512")
      .toString("hex");

    // 해싱된 비밀번호가 일치하는지 비교
    if (hashedInputPassword === user.password) {
      cb(null, user);
    } else {
      cb(null, null);
    }
  } catch (error) {
    console.error("Select user error:", error);
    cb(error as Error);
  }
};

// 비밀번호와 salt 조회
export const getUserPasswordAndSalt = async (
  user_id: number,
  callback: Callback<{ password: string; salt: string }>
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: parseInt(String(user_id)) },
      select: { password: true, salt: true },
    });

    if (!user) {
      console.log("사용자 조회 실패");
      return callback(new Error("사용자를 찾을 수 없습니다."));
    }

    console.log("사용자 정보 조회 성공");
    callback(null, { password: user.password, salt: user.salt });
  } catch (error) {
    console.error("DB 오류 발생:", error);
    callback(error as Error);
  }
};

// user_id로 사용자 정보 가져오기
export const get_user = async (
  user_id: number,
  cb: Callback<User | null> = () => {}
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: parseInt(String(user_id)) },
    });
    cb(null, user);
  } catch (error) {
    console.error("Get user error:", error);
    cb(error as Error);
  }
};

// 회원 정보 수정
export const update = async (
  data: UpdateUserData,
  cb: Callback<User> = () => {}
): Promise<void> => {
  try {
    // 비밀번호가 수정된 경우에만 암호화
    const hashedPassword = data.password
      ? await bcrypt.hash(data.password, 10)
      : null;

    const updatedUser = await prisma.user.update({
      where: { user_id: parseInt(String(data.user_id)) },
      data: {
        username: data.username,
        email: data.email,
        profile_name: data.profile_name,
        password: hashedPassword || data.password,
        age: data.age,
        gender: data.gender,
        login_type: data.login_type,
        profile_picture: data.profile_picture,
      },
    });

    cb(null, updatedUser);
  } catch (error) {
    console.error("Update user error:", error);
    cb(error as Error);
  }
};

// 회원 탈퇴
export const deleteUser = async (
  user_id: number,
  cb: Callback<User> = () => {}
): Promise<void> => {
  try {
    const deletedUser = await prisma.user.delete({
      where: { user_id: parseInt(String(user_id)) },
    });
    cb(null, deletedUser);
  } catch (error) {
    console.error("Delete user error:", error);
    cb(error as Error);
  }
};
