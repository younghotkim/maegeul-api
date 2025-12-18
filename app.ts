import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// 환경 변수 로드 (다른 모듈 import 전에 실행)
dotenv.config();

// 라우트 파일들
import analyzeRoute from "./routes/analyze";
import userRoutes from "./routes/user";
import kakaoAuthRoutes from "./routes/kakao";
import moodmeterRoutes from "./routes/moodRoutes";
import diaryRoutes from "./routes/diaryRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import emotionAnalysisRoutes from "./routes/emotionAnalysisRoutes";

import "./config/passport";

const app = express();

// 미들웨어 설정
// CORS 설정 - 클라이언트와 서버 분리 배포를 위한 환경 변수 지원
const getAllowedOrigins = (): string[] | boolean => {
  // 프로덕션 환경
  if (process.env.NODE_ENV === "production") {
    // 환경 변수로 명시적으로 설정된 경우
    const allowedOrigins = process.env.CORS_ORIGINS;
    if (allowedOrigins) {
      return allowedOrigins.split(",").map((origin) => origin.trim());
    }
    // 환경 변수가 없으면 경고만 출력 (보안상 명시적 설정 권장)
    console.warn(
      "⚠️  CORS_ORIGINS 환경 변수가 설정되지 않았습니다. 모든 origin을 허용합니다."
    );
    return true; // 기본값 제거, 명시적 설정 강제
  }
  // 개발 환경에서는 모든 origin 허용 (공유망 접근 가능)
  return true;
};

app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 세션 설정
app.use(
  session({
    secret: process.env.SESSION_SECRET || "defaultSecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      // 세션 쿠키 도메인 설정 (환경 변수로 설정 가능)
      // 개발 환경에서는 domain을 설정하지 않음 (다양한 IP/호스트 접속 허용)
      ...(process.env.NODE_ENV === "production" &&
        process.env.SESSION_DOMAIN && { domain: process.env.SESSION_DOMAIN }),
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax", // 개발 환경에서는 lax 사용
    },
  })
);

// Passport 초기화 및 세션 설정
app.use(passport.initialize());
app.use(passport.session());

// 라우트 설정
app.use("/api/analyze", analyzeRoute);
app.use("/api", userRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api", uploadRoutes);
app.use("/api", kakaoAuthRoutes);
app.use("/api", moodmeterRoutes);
app.use("/api", diaryRoutes);
app.use("/api", emotionAnalysisRoutes);

// 클라이언트와 서버 분리 배포 지원
// SERVE_CLIENT_STATIC=true로 설정하면 서버에서 클라이언트 빌드 파일을 서빙 (통합 배포용)
// false이거나 설정하지 않으면 API만 제공 (분리 배포)
if (
  process.env.NODE_ENV === "production" &&
  process.env.SERVE_CLIENT_STATIC === "true"
) {
  const clientBuildPath = path.join(__dirname, "../client/build");

  // 클라이언트 빌드 폴더 존재 여부 확인
  if (fs.existsSync(clientBuildPath)) {
    console.log("서버에서 클라이언트 정적 파일 서빙 모드 활성화");
    // 정적 파일 서빙 (CSS, JS, 이미지 등)
    app.use(
      express.static(clientBuildPath, {
        maxAge: "1y", // 캐시 최적화
        etag: true,
      })
    );

    // React Router를 위한 fallback 라우트
    // API 라우트가 아닌 모든 요청을 index.html로 리다이렉트
    app.get("*", (req, res, next) => {
      // API 라우트는 제외
      if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
        return next();
      }
      res.sendFile(path.join(clientBuildPath, "index.html"));
    });
  } else {
    console.warn(
      `Warning: SERVE_CLIENT_STATIC=true이지만 클라이언트 빌드 폴더를 찾을 수 없습니다: ${clientBuildPath}`
    );
  }
}

// 기본 라우트 (API 서버 상태 확인용)
app.get("/", (req, res) => {
  res.json({
    message: "MaeGeul API Server",
    version: "1.0.0",
    status: "running",
    mode:
      process.env.SERVE_CLIENT_STATIC === "true" ? "integrated" : "api-only",
  });
});

// 헬스 체크 엔드포인트
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 서버 시작
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0"; // 공유망 접근을 위해 0.0.0.0 사용
app.listen(Number(PORT), HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// 업로드 폴더가 없다면 생성
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}
