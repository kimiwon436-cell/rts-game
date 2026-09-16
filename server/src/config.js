const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseOrigins(value) {
  if (!value) return DEV_ORIGINS;
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === 'production';
const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT?.trim() ?? '';

if (isProduction && !firebaseServiceAccount) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT가 없습니다. 운영 환경에서는 개발용 게스트 인증을 쓸 수 없습니다.');
}

export const config = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  clientOrigins: parseOrigins(process.env.CLIENT_ORIGINS),
  isProduction,
  firebaseServiceAccount,
  /** 'firebase': ID 토큰 검증, 'dev': 게스트 토큰 허용 (로컬 개발 전용) */
  authMode: firebaseServiceAccount ? 'firebase' : 'dev',
  /** 경기 중 연결이 끊긴 플레이어의 자리를 지켜 주는 시간(초) */
  reconnectGraceSec: Number(process.env.RECONNECT_GRACE_SEC) || 60,
});
