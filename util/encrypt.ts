import crypto from "crypto";

// 암호화 설정
const algorithm = "aes-256-cbc";

// 암호화 함수
export function encrypt(text: string, encryptionKey: string): string {
  const iv = crypto.randomBytes(16);
  const keyBuffer = Buffer.from(encryptionKey, "hex");
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// 복호화 함수
export function decrypt(encryptedText: string, encryptionKey: string): string {
  const textParts = encryptedText.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedContent = Buffer.from(textParts.join(":"), "hex");
  const keyBuffer = Buffer.from(encryptionKey, "hex");

  const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);
  let decrypted = decipher.update(encryptedContent);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
}

// 카카오 암호화키 생성 (PBKDF2)
export function generateEncryptionKey(
  kakaoId: string | number,
  salt: string
): string {
  return crypto
    .pbkdf2Sync(kakaoId.toString(), salt, 10000, 32, "sha512")
    .toString("hex");
}

// 랜덤 Salt 생성
export function generateRandomSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}
