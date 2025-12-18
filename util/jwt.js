const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key"; // 환경변수 또는 기본 비밀키

// JWT 토큰을 생성하는 함수
function generateToken(user) {
  const payload = {
    userId: user.user_id, // 사용자 ID
    profileName: user.profile_name, // 사용자 이름
  };

  // 토큰 생성
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
}

module.exports = generateToken;
