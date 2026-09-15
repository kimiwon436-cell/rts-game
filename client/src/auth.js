import { FIREBASE_CONFIG } from './config.js';

const DEV_UID_KEY = 'rune.devUid';

/**
 * 로그인하고 세션을 돌려준다.
 * - Firebase 설정이 있으면 익명 로그인
 * - 없으면 개발용 게스트 (서버도 개발 모드일 때만 접속된다)
 * 두 방식 모두 탭마다 다른 플레이어가 되므로, 브라우저 탭 두 개로 1v1을 시험할 수 있다.
 *
 * @returns {Promise<{ mode: 'firebase' | 'dev', uid: string, getToken: () => Promise<string>, saveProfile: (nickname: string) => Promise<void> }>}
 */
export function signIn() {
  return FIREBASE_CONFIG ? signInWithFirebase(FIREBASE_CONFIG) : signInAsDevGuest();
}

async function signInWithFirebase(firebaseConfig) {
  const [{ initializeApp }, authSdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
  const { user } = await authSdk.signInAnonymously(auth);

  return {
    mode: 'firebase',
    uid: user.uid,
    getToken: () => user.getIdToken(),
    saveProfile: (nickname) => saveFirestoreProfile(app, user.uid, nickname),
  };
}

async function saveFirestoreProfile(app, uid, nickname) {
  const { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');
  const ref = doc(getFirestore(app), 'users', uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, { nickname, createdAt: serverTimestamp() });
  } else if (snapshot.data().nickname !== nickname) {
    await updateDoc(ref, { nickname });
  }
}

async function signInAsDevGuest() {
  let uid = null;
  try {
    uid = sessionStorage.getItem(DEV_UID_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 이번 페이지에서만 쓰는 id를 만든다
  }
  if (!uid) {
    uid = `dev:${randomId()}`;
    try {
      sessionStorage.setItem(DEV_UID_KEY, uid);
    } catch {
      // 무시
    }
  }
  return {
    mode: 'dev',
    uid,
    getToken: async () => uid,
    saveProfile: async () => {},
  };
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // http로 LAN 주소에 접속하면 randomUUID가 없다
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Firebase 로그인 오류를 사람이 읽을 수 있는 문장으로 바꾼다. */
export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Firebase 콘솔의 Authentication → 로그인 방법에서 “익명”을 사용 설정하세요.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'VITE_FIREBASE_API_KEY가 올바르지 않습니다. client/.env를 확인하세요.';
    case 'auth/network-request-failed':
      return 'Firebase에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
    default:
      return `로그인하지 못했습니다 (${err?.code ?? err?.message ?? '알 수 없는 오류'})`;
  }
}
