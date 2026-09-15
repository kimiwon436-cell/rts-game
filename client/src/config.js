const env = import.meta.env;

export const SERVER_URL = env.VITE_SERVER_URL || 'http://localhost:3000';

/** Firebase 웹 앱 설정. API 키가 없으면 null이고, 이때는 개발용 게스트로 접속한다. */
export const FIREBASE_CONFIG = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }
  : null;
