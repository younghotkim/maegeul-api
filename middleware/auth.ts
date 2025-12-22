import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// JWT_SECRET 가져오기
const JWT_SECRET = (() => {
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    return "dev-jwt-secret-change-in-production";
  }
  return process.env.JWT_SECRET;
})();

// JWT 토큰에서 추출한 사용자 정보를 Request에 추가
declare global {
  namespace Express {
    interface Request {
      userId?: number;
      profileName?: string;
    }
  }
}

/**
 * JWT 토큰 인증 미들웨어
 * Authorization 헤더에서 Bearer 토큰을 추출하고 검증합니다.
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({
        message: "인증 토큰이 필요합니다.",
        error: "NO_TOKEN",
      });
      return;
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          res.status(401).json({
            message: "토큰이 만료되었습니다. 다시 로그인해주세요.",
            error: "TOKEN_EXPIRED",
          });
          return;
        }
        res.status(403).json({
          message: "유효하지 않은 토큰입니다.",
          error: "INVALID_TOKEN",
        });
        return;
      }

      // 토큰에서 사용자 정보 추출
      const payload = decoded as { userId: number; profileName: string };
      req.userId = payload.userId;
      req.profileName = payload.profileName;

      next();
    });
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      message: "인증 처리 중 오류가 발생했습니다.",
      error: "AUTH_ERROR",
    });
  }
};

/**
 * 선택적 인증 미들웨어
 * 토큰이 있으면 검증하고, 없으면 그냥 통과시킵니다.
 */
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    next();
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      const payload = decoded as { userId: number; profileName: string };
      req.userId = payload.userId;
      req.profileName = payload.profileName;
    }
    next();
  });
};

/**
 * 사용자 ID 검증 미들웨어
 * 요청의 user_id 파라미터가 인증된 사용자의 ID와 일치하는지 확인합니다.
 */
export const verifyUserOwnership = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestedUserId = parseInt(
    req.params.user_id || req.body.user_id || req.query.user_id
  );

  if (!req.userId) {
    res.status(401).json({
      message: "인증이 필요합니다.",
      error: "NOT_AUTHENTICATED",
    });
    return;
  }

  if (requestedUserId !== req.userId) {
    res.status(403).json({
      message: "권한이 없습니다.",
      error: "FORBIDDEN",
    });
    return;
  }

  next();
};
