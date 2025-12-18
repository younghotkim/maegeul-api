import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";

const router = express.Router();

// 클라이언트 콜백 URL을 동적으로 가져오는 함수
const getClientCallbackURL = (req: Request): string => {
  // 1. 환경 변수로 명시적으로 설정된 경우
  const envUrl = process.env.REACT_APP_BASE_URL || process.env.CLIENT_BASE_URL;
  if (
    envUrl &&
    !envUrl.includes("YOUR_SERVER_IP") &&
    envUrl.startsWith("http")
  ) {
    return envUrl.endsWith("/") ? envUrl : `${envUrl}/`;
  }

  // 2. 프로덕션 환경
  if (process.env.NODE_ENV === "production") {
    // 환경 변수로 명시적으로 설정된 경우
    const clientBaseUrl =
      process.env.CLIENT_BASE_URL || process.env.REACT_APP_BASE_URL;
    if (clientBaseUrl) {
      return clientBaseUrl.endsWith("/") ? clientBaseUrl : `${clientBaseUrl}/`;
    }

    // 환경 변수가 없으면 경고
    console.warn(
      "⚠️  CLIENT_BASE_URL 또는 REACT_APP_BASE_URL 환경 변수가 설정되지 않았습니다."
    );
    // 기본값 제거, 명시적 설정 강제
    throw new Error(
      "클라이언트 콜백 URL을 설정하려면 CLIENT_BASE_URL 환경 변수를 설정하세요."
    );
  }

  // 3. 세션에 저장된 클라이언트 호스트 사용 (카카오 로그인 시작 시 저장됨)
  const clientHost = (req.session as any)?.clientHost;
  if (clientHost) {
    return clientHost.endsWith("/") ? clientHost : `${clientHost}/`;
  }

  // 4. Referer 헤더에서 추출
  const referer = req.get("Referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}/`;
    } catch (e) {
      // URL 파싱 실패 시 무시
    }
  }

  // 5. Origin 헤더에서 추출
  const origin = req.get("Origin");
  if (origin) {
    return origin.endsWith("/") ? origin : `${origin}/`;
  }

  // 6. 기본값 (개발 환경)
  return "http://localhost:3000/";
};

// 카카오 로그인 시작 - 클라이언트 호스트를 세션에 저장하고 state로도 전달
router.get("/kakao", (req: Request, res: Response, next: NextFunction) => {
  // 1. 쿼리 파라미터에서 클라이언트 호스트 추출 (우선순위 1)
  const clientHostParam = req.query.clientHost as string;
  let clientHost: string | null = null;

  if (clientHostParam) {
    try {
      const decodedHost = decodeURIComponent(clientHostParam);
      const url = new URL(decodedHost);
      clientHost = `${url.protocol}//${url.host}`;
      (req.session as any).clientHost = clientHost;
      console.log(
        `카카오 로그인: 클라이언트 호스트 저장됨 (쿼리 파라미터): ${clientHost}`
      );
    } catch (e) {
      console.warn("쿼리 파라미터에서 클라이언트 호스트 파싱 실패:", e);
    }
  }

  // 2. 세션에 저장되지 않았다면 Referer 헤더에서 추출
  if (!clientHost) {
    const referer = req.get("Referer");
    if (referer) {
      try {
        const url = new URL(referer);
        clientHost = `${url.protocol}//${url.host}`;
        (req.session as any).clientHost = clientHost;
        console.log(
          `카카오 로그인: 클라이언트 호스트 저장됨 (Referer): ${clientHost}`
        );
      } catch (e) {
        console.warn("Referer에서 클라이언트 호스트 파싱 실패:", e);
      }
    }
  }

  // 3. 여전히 없다면 Origin 헤더에서 추출
  if (!clientHost) {
    const origin = req.get("Origin");
    if (origin) {
      clientHost = origin;
      (req.session as any).clientHost = clientHost;
      console.log(
        `카카오 로그인: 클라이언트 호스트 저장됨 (Origin): ${clientHost}`
      );
    }
  }

  // 클라이언트 호스트를 state 파라미터로도 전달 (세션 실패 대비)
  const authenticateOptions: any = {};
  if (clientHost) {
    // state에 클라이언트 호스트를 base64로 인코딩하여 전달
    authenticateOptions.state = Buffer.from(clientHost).toString("base64");
    console.log(
      `카카오 로그인: state 파라미터에 클라이언트 호스트 포함: ${clientHost}`
    );
  }

  passport.authenticate("kakao", authenticateOptions)(req, res, next);
});

router.get(
  "/kakao/callback",
  (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    console.log("카카오 콜백 시작:", new Date().toISOString());

    // 타임아웃 설정 (10초)
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.error("카카오 콜백 타임아웃 발생");
        const callbackURL = getClientCallbackURL(req);
        res.redirect(`${callbackURL}mainlogin?error=timeout`);
      }
    }, 10000);

    // state 파라미터에서 클라이언트 호스트 복원 시도 (세션 실패 대비)
    const stateParam = req.query.state as string;
    if (stateParam) {
      try {
        const decodedHost = Buffer.from(stateParam, "base64").toString("utf-8");
        if (decodedHost && decodedHost.startsWith("http")) {
          (req.session as any).clientHost = decodedHost;
          console.log(
            `카카오 콜백: state에서 클라이언트 호스트 복원: ${decodedHost}`
          );
        }
      } catch (e) {
        console.warn("state 파라미터에서 클라이언트 호스트 복원 실패:", e);
      }
    }

    // 디버깅: 세션 정보 확인
    console.log("카카오 콜백 - 세션 정보:", {
      clientHost: (req.session as any)?.clientHost,
      sessionID: req.sessionID,
      hasSession: !!req.session,
      stateParam: stateParam ? "있음" : "없음",
    });

    passport.authenticate("kakao", (err: any, user: any, info: any) => {
      clearTimeout(timeout); // 타임아웃 제거

      const elapsedTime = Date.now() - startTime;
      console.log(`카카오 인증 처리 시간: ${elapsedTime}ms`);

      if (err) {
        console.error("카카오 로그인 에러:", err);
        const callbackURL = getClientCallbackURL(req);
        if (!res.headersSent) {
          res.redirect(`${callbackURL}mainlogin?error=login_failed`);
        }
        return;
      }

      if (!user) {
        console.error("카카오 로그인 실패 - 사용자 정보 없음:", info);
        const callbackURL = getClientCallbackURL(req);
        if (!res.headersSent) {
          res.redirect(`${callbackURL}mainlogin?error=login_failed`);
        }
        return;
      }

      try {
        const token = jwt.sign(
          { userId: user.user_id },
          process.env.JWT_SECRET as string,
          {
            expiresIn: "1h",
          }
        );

        const callbackURL = getClientCallbackURL(req);
        const redirectURL = `${callbackURL}kakao/callback?userId=${user.user_id}&token=${token}`;

        console.log(
          `카카오 로그인 성공 (${elapsedTime}ms) - 리다이렉트: ${callbackURL}kakao/callback?userId=${
            user.user_id
          }&token=${token.substring(0, 20)}...`
        );

        if (!res.headersSent) {
          res.redirect(redirectURL);
        } else {
          console.warn("응답이 이미 전송되었습니다. 리다이렉트 불가능.");
        }
      } catch (tokenError) {
        console.error("JWT 토큰 생성 실패:", tokenError);
        const callbackURL = getClientCallbackURL(req);
        if (!res.headersSent) {
          res.redirect(`${callbackURL}mainlogin?error=token_error`);
        }
      }
    })(req, res, (error: any) => {
      clearTimeout(timeout);
      if (error) {
        console.error("Passport 인증 미들웨어 에러:", error);
        const callbackURL = getClientCallbackURL(req);
        if (!res.headersSent) {
          res.redirect(`${callbackURL}mainlogin?error=server_error`);
        }
      } else {
        next();
      }
    });
  }
);

export default router;
