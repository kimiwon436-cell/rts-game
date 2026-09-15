import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let auth = null;

/** Base64로 인코딩한 서비스 계정 JSON으로 Admin SDK를 초기화한다. */
export function initFirebaseAdmin(serviceAccountBase64) {
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(serviceAccountBase64, 'base64').toString('utf8'));
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT를 읽을 수 없습니다. 서비스 계정 JSON 파일을 Base64로 인코딩한 값인지 확인하세요.',
    );
  }
  const app = initializeApp({ credential: cert(credentials) });
  auth = getAuth(app);
  return { projectId: credentials.project_id };
}

/** Firebase ID 토큰을 검증하고 uid를 돌려준다. 실패하면 예외를 던진다. */
export async function verifyIdToken(token) {
  if (!auth) throw new Error('Firebase Admin이 초기화되지 않았습니다.');
  const decoded = await auth.verifyIdToken(token);
  return decoded.uid;
}
