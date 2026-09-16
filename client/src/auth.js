import { PASSWORD_MIN } from '@rune/shared/rules/nickname.js';
import { FIREBASE_CONFIG } from './config.js';

/**
 * 로그인 서비스. 두 방식 모두 같은 모양이다.
 * - Firebase: 이메일·비밀번호 계정. 브라우저를 닫아도 로그인이 유지된다 (browserLocalPersistence)
 * - 개발 모드(Firebase 설정 없음): 이 브라우저에만 저장되는 연습용 계정. 보안이 없으니 로컬 개발에만 쓴다
 *
 * session = { mode, uid, email, getToken() }
 *
 * @returns {Promise<{
 *   mode: 'firebase' | 'dev',
 *   onChange: (listener: (session: object | null) => void) => () => void,
 *   signUp: (email: string, password: string) => Promise<object>,
 *   signIn: (email: string, password: string) => Promise<object>,
 *   signOut: () => Promise<void>,
 *   sendPasswordReset: (email: string) => Promise<void>,
 * }>}
 */
export function createAuth() {
  return FIREBASE_CONFIG ? createFirebaseAuth(FIREBASE_CONFIG) : Promise.resolve(createDevAuth(localStorage));
}

/** 이메일은 대소문자를 구분하지 않고, 앞뒤 공백을 지운다 */
export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 서버에 보내기 전에 걸러낼 수 있는 입력 오류. Firebase 오류 코드와 같은 모양으로 던진다 */
function checkCredentials(email, password) {
  if (!EMAIL_PATTERN.test(normalizeEmail(email))) throw authError('auth/invalid-email');
  if (String(password ?? '').length < PASSWORD_MIN) throw authError('auth/weak-password');
}

const authError = (code) => Object.assign(new Error(code), { code });

// ---------- Firebase ----------

async function createFirebaseAuth(firebaseConfig) {
  const [{ initializeApp }, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(firebaseConfig);
  const auth = sdk.getAuth(app);
  auth.languageCode = 'ko'; // 비밀번호 재설정 메일을 한국어로
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);

  const toSession = (user) => ({ mode: 'firebase', uid: user.uid, email: user.email, getToken: () => user.getIdToken() });

  return {
    mode: 'firebase',
    onChange: (listener) => sdk.onAuthStateChanged(auth, (user) => listener(user ? toSession(user) : null)),
    async signUp(email, password) {
      checkCredentials(email, password);
      const { user } = await sdk.createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
      return toSession(user);
    },
    async signIn(email, password) {
      if (!EMAIL_PATTERN.test(normalizeEmail(email))) throw authError('auth/invalid-email');
      const { user } = await sdk.signInWithEmailAndPassword(auth, normalizeEmail(email), password);
      return toSession(user);
    },
    signOut: () => sdk.signOut(auth),
    async sendPasswordReset(email) {
      if (!EMAIL_PATTERN.test(normalizeEmail(email))) throw authError('auth/invalid-email');
      await sdk.sendPasswordResetEmail(auth, normalizeEmail(email));
    },
  };
}

// ---------- 개발 모드 ----------

const DEV_ACCOUNTS_KEY = 'rune.dev.accounts';
const DEV_SESSION_KEY = 'rune.dev.session';

/**
 * 개발용 계정. 비밀번호는 소금을 친 SHA-256으로만 저장하지만, 이 브라우저 안에만 있으므로 보안 수단이 아니다.
 * @param {Storage} storage localStorage (테스트에서는 흉내 낸 저장소)
 */
export function createDevAuth(storage, { digest = sha256 } = {}) {
  const listeners = new Set();
  const read = (key, fallback) => {
    try {
      return JSON.parse(storage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      if (value == null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // 저장소를 못 쓰면 이번 페이지에서만 로그인된다
    }
  };
  const toSession = ({ uid, email }) => ({ mode: 'dev', uid, email, getToken: async () => uid });
  let current = read(DEV_SESSION_KEY, null);
  const emit = () => listeners.forEach((listener) => listener(current ? toSession(current) : null));
  const login = (account) => {
    current = { uid: account.uid, email: account.email };
    write(DEV_SESSION_KEY, current);
    emit();
    return toSession(current);
  };

  return {
    mode: 'dev',
    onChange(listener) {
      listeners.add(listener);
      queueMicrotask(() => listeners.has(listener) && listener(current ? toSession(current) : null));
      return () => listeners.delete(listener);
    },
    async signUp(email, password) {
      checkCredentials(email, password);
      const key = normalizeEmail(email);
      const accounts = read(DEV_ACCOUNTS_KEY, {});
      if (accounts[key]) throw authError('auth/email-already-in-use');
      const salt = randomHex(16);
      const account = { uid: `dev:${randomHex(16)}`, email: key, salt, hash: await digest(`${salt}:${password}`) };
      write(DEV_ACCOUNTS_KEY, { ...accounts, [key]: account });
      return login(account);
    },
    async signIn(email, password) {
      const account = read(DEV_ACCOUNTS_KEY, {})[normalizeEmail(email)];
      if (!account || account.hash !== (await digest(`${account.salt}:${password}`))) {
        throw authError('auth/invalid-credential');
      }
      return login(account);
    },
    async signOut() {
      current = null;
      write(DEV_SESSION_KEY, null);
      emit();
    },
    async sendPasswordReset() {
      throw authError('dev/no-email');
    },
  };
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) return `plain:${text}`; // http로 LAN 주소에 접속하면 subtle이 없다 (개발 모드뿐)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteCount) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 로그인 오류를 사람이 읽을 수 있는 문장으로 바꾼다. */
export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-email':
      return '이메일 주소 형식이 올바르지 않습니다.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일입니다. 로그인해 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return '이메일 또는 비밀번호가 맞지 않습니다.';
    case 'auth/too-many-requests':
      return '시도가 너무 많습니다. 잠시 뒤에 다시 해 주세요.';
    case 'auth/user-disabled':
      return '사용이 중지된 계정입니다.';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Firebase 콘솔의 Authentication → 로그인 방법에서 “이메일/비밀번호”를 사용 설정하세요.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'VITE_FIREBASE_API_KEY가 올바르지 않습니다. client/.env를 확인하세요.';
    case 'auth/network-request-failed':
      return 'Firebase에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
    case 'dev/no-email':
      return '개발 모드에서는 비밀번호 재설정 메일을 보낼 수 없습니다.';
    default:
      return `처리하지 못했습니다 (${err?.code ?? err?.message ?? '알 수 없는 오류'})`;
  }
}
