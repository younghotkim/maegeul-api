import passport from "passport";
import { Strategy as KakaoStrategy } from "passport-kakao";
import * as userModel from "../models/user";
import { User } from "@prisma/client";
import fs from "fs";

// 환경 변수 검증 및 Kakao 전략 등록
const kakaoClientID = process.env.KAKAO_CLIENT_ID;
if (kakaoClientID) {
  // 카카오 콜백 URL 설정 (서버 측 - 카카오가 서버로 콜백을 보낼 URL)
  const getKakaoCallbackURL = () => {
    // 환경 변수로 명시적으로 설정된 경우 (최우선)
    const envCallbackURL = process.env.KAKAO_CALLBACK_URL;
    if (
      envCallbackURL &&
      !envCallbackURL.includes("YOUR_SERVER_IP") &&
      envCallbackURL.startsWith("http")
    ) {
      console.log(`카카오 콜백 URL (환경 변수): ${envCallbackURL}`);
      return envCallbackURL;
    }

    // 프로덕션 환경
    if (process.env.NODE_ENV === "production") {
      // 디버깅: 환경 변수 로깅
      console.log("🔍 환경 변수 확인:");
      console.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`  - SERVER_HOST: ${process.env.SERVER_HOST || "(없음)"}`);
      console.log(
        `  - EXTERNAL_HOST: ${process.env.EXTERNAL_HOST || "(없음)"}`
      );
      console.log(
        `  - RENDER_EXTERNAL_HOSTNAME: ${
          process.env.RENDER_EXTERNAL_HOSTNAME || "(없음)"
        }`
      );
      console.log(
        `  - KAKAO_CALLBACK_URL: ${process.env.KAKAO_CALLBACK_URL || "(없음)"}`
      );
      console.log(`  - PORT: ${process.env.PORT || "5000"}`);

      // 환경 변수로 명시적으로 설정된 경우 (우선순위: KAKAO_CALLBACK_URL > SERVER_HOST > EXTERNAL_HOST > RENDER_EXTERNAL_HOSTNAME)
      const serverHost =
        process.env.SERVER_HOST ||
        process.env.EXTERNAL_HOST ||
        process.env.RENDER_EXTERNAL_HOSTNAME; // Render 자동 제공 환경 변수
      const serverPort = process.env.PORT || "5000";

      if (serverHost) {
        const protocol = process.env.SERVER_PROTOCOL || "https";
        const port = protocol === "https" ? "" : `:${serverPort}`;
        const callbackURL = `${protocol}://${serverHost}${port}/api/kakao/callback`;
        console.log(`✅ 카카오 콜백 URL 생성: ${callbackURL}`);
        return callbackURL;
      }

      // 환경 변수가 없으면 경고
      console.warn(
        "⚠️  SERVER_HOST, EXTERNAL_HOST, 또는 RENDER_EXTERNAL_HOSTNAME 환경 변수가 설정되지 않았습니다."
      );
      console.warn("⚠️  카카오 콜백 URL을 자동으로 생성할 수 없습니다.");
      console.warn(
        "⚠️  Render 환경에서는 RENDER_EXTERNAL_HOSTNAME이 자동으로 제공됩니다."
      );
      // 기본값 제거, 명시적 설정 강제
      throw new Error(
        "카카오 콜백 URL을 설정하려면 SERVER_HOST, EXTERNAL_HOST, RENDER_EXTERNAL_HOSTNAME 중 하나 또는 KAKAO_CALLBACK_URL 환경 변수를 설정하세요."
      );
    }

    // 도커 환경 감지 (Docker 컨테이너 내부에서 실행 중인지 확인)
    let isDocker = false;
    try {
      isDocker =
        process.env.DOCKER_ENV === "true" ||
        process.env.IS_DOCKER === "true" ||
        (fs.existsSync && fs.existsSync("/.dockerenv"));
    } catch (e) {
      // 파일 시스템 접근 실패 시 무시
    }

    if (isDocker) {
      // 도커 환경에서는 nginx를 통해 하나의 포트로 접근
      // NGINX_PORT 환경 변수 또는 기본값 3000 사용
      const nginxPort = process.env.NGINX_PORT || "3000";
      const serverHost = process.env.SERVER_HOST || process.env.EXTERNAL_HOST;

      if (serverHost) {
        const callbackURL = `http://${serverHost}:${nginxPort}/api/kakao/callback`;
        console.log(`카카오 콜백 URL (도커 환경, SERVER_HOST): ${callbackURL}`);
        return callbackURL;
      }

      // SERVER_HOST가 없으면 환경 변수로 설정 필요
      console.warn(`⚠️  도커 환경이지만 SERVER_HOST가 설정되지 않았습니다.`);
      console.warn(`   환경 변수 설정: SERVER_HOST=YOUR_SERVER_IP`);
    }

    // 개발 환경 - SERVER_HOST 환경 변수 사용 (외부 IP 설정 가능)
    const serverHost = process.env.SERVER_HOST;
    const serverPort = process.env.PORT || "5001";

    if (
      serverHost &&
      serverHost !== "localhost" &&
      serverHost !== "127.0.0.1"
    ) {
      const callbackURL = `http://${serverHost}:${serverPort}/api/kakao/callback`;
      console.log(`카카오 콜백 URL (SERVER_HOST): ${callbackURL}`);
      return callbackURL;
    }

    // SERVER_HOST가 없거나 localhost인 경우 - 네트워크 인터페이스에서 IP 추출 시도
    const os = require("os");
    const networkInterfaces = os.networkInterfaces();
    let externalIP: string | null = null;

    // 외부 접근 가능한 IP 주소 찾기 (localhost, 127.0.0.1, ::1 제외)
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      if (interfaces) {
        for (const iface of interfaces) {
          // IPv4이고 내부 루프백이 아닌 경우
          if (iface.family === "IPv4" && !iface.internal) {
            externalIP = iface.address;
            break;
          }
        }
        if (externalIP) break;
      }
    }

    if (externalIP) {
      const callbackURL = `http://${externalIP}:${serverPort}/api/kakao/callback`;
      console.log(`카카오 콜백 URL (자동 감지): ${callbackURL}`);
      return callbackURL;
    }

    // 기본값 (localhost - 개발 환경에서만 사용)
    const defaultURL = `http://localhost:${serverPort}/api/kakao/callback`;
    console.warn(
      `⚠️  카카오 콜백 URL을 자동 감지하지 못했습니다. 기본값 사용: ${defaultURL}`
    );
    console.warn(`⚠️  외부 접속을 위해서는 환경 변수 설정이 필요합니다:`);
    console.warn(
      `   - KAKAO_CALLBACK_URL=http://YOUR_SERVER_IP:${serverPort}/api/kakao/callback`
    );
    console.warn(`   또는`);
    console.warn(`   - SERVER_HOST=YOUR_SERVER_IP`);
    return defaultURL;
  };

  passport.use(
    new KakaoStrategy(
      {
        clientID: kakaoClientID,
        callbackURL: getKakaoCallbackURL(),
      },
      async (accessToken, refreshToken, profile, done) => {
        const startTime = Date.now();
        console.log("카카오 프로필 수신:", {
          id: profile.id,
          displayName: profile.displayName,
          email: profile._json.kakao_account?.email,
        });

        try {
          // 타임아웃 설정 (8초)
          const timeout = setTimeout(() => {
            console.error("handleKakaoLogin 타임아웃 발생");
            return done(new Error("카카오 로그인 처리 시간 초과"));
          }, 8000);

          userModel.handleKakaoLogin(profile, (err, user) => {
            clearTimeout(timeout);
            const elapsedTime = Date.now() - startTime;

            if (err) {
              console.error(`카카오 로그인 에러 (${elapsedTime}ms):`, err);
              return done(err);
            }

            if (!user) {
              console.error(
                `카카오 로그인 실패 - 사용자 없음 (${elapsedTime}ms)`
              );
              return done(new Error("사용자 정보를 가져올 수 없습니다"));
            }

            console.log(`카카오 로그인 성공 (${elapsedTime}ms):`, {
              user_id: user.user_id,
              email: user.email,
            });
            return done(null, user);
          });
        } catch (error) {
          const elapsedTime = Date.now() - startTime;
          console.error(`카카오 로그인 예외 발생 (${elapsedTime}ms):`, error);
          return done(error as Error);
        }
      }
    )
  );
} else {
  console.warn(
    "Warning: KAKAO_CLIENT_ID is not set. Kakao OAuth strategy will not be registered."
  );
}

// 세션에 사용자 정보를 저장
passport.serializeUser((user: any, done) => {
  done(null, user.user_id);
});

// 세션에서 사용자 정보를 복원
passport.deserializeUser((user_id: number, done) => {
  userModel.get_user(user_id, (err, user) => {
    if (err) return done(err);
    done(null, user);
  });
});

export default passport;
