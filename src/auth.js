import { PASSWORD_MIN } from '@rune/shared/rules/nickname.js';
import { LOGIN_ID_MESSAGES, emailToLoginId, loginIdToEmail, validateLoginId } from '@rune/shared/rules/loginId.js';
import { FIREBASE_CONFIG } from './config.js';

/**
 * 로그인 서비스 (아이디 + 비밀번호). 두 방식 모두 같은 모양이다.
 * - Firebase: 아이디를 프로젝트 전용 내부 주소로 바꿔 이메일·비밀번호 계정으로 만든다 (사용자에게는 아이디만 보인다).
 *   브라우저를 닫아도 로그인이 유지된다 (browserLocalPersistence)
 * - 개발 모드(Firebase 설정 없음): 이 브라우저에만 저장되는 연습용 계정. 보안이 없으니 로컬 개발에만 쓴다
 *
 * session = { mode, uid, loginId, getToken() }
 *
 * @returns {Promise<{
 *   mode: 'firebase' | 'dev',
 *   onChange: (listener: (session: object | null) => void) => () => void,
 *   signUp: (loginId: string, password: string) => Promise<object>,
 *   signIn: (loginId: string, password: string) => Promise<object>,
 *   signOut: () => Promise<void>,
 * }>}
 */
export function createAuth() {
  return FIREBASE_CONFIG ? createFirebaseAuth(FIREBASE_CONFIG) : Promise.resolve(createDevAuth(localStorage));
}

const authError = (code) => Object.assign(new Error(code), { code });

/** 서버에 보내기 전에 걸러낼 수 있는 입력 오류 */
function checkLoginId(raw) {
  const checked = validateLoginId(raw);
  if (!checked.ok) throw authError(`id/${checked.reason}`);
  return checked.loginId;
}

function checkPassword(password) {
  if (String(password ?? '').length < PASSWORD_MIN) throw authError('auth/weak-password');
}

// ---------- Firebase ----------

async function createFirebaseAuth(firebaseConfig) {
  const [{ initializeApp }, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp(firebaseConfig);
  const auth = sdk.getAuth(app);
  await sdk.setPersistence(auth, sdk.browserLocalPersistence);

  const emailOf = (loginId) => loginIdToEmail(loginId, firebaseConfig.projectId);
  const toSession = (user) => ({
    mode: 'firebase',
    uid: user.uid,
    loginId: emailToLoginId(user.email),
    getToken: () => user.getIdToken(),
  });

  return {
    mode: 'firebase',
    onChange: (listener) => sdk.onAuthStateChanged(auth, (user) => listener(user ? toSession(user) : null)),
    async signUp(rawLoginId, password) {
      const loginId = checkLoginId(rawLoginId);
      checkPassword(password);
      const { user } = await sdk.createUserWithEmailAndPassword(auth, emailOf(loginId), password);
      return toSession(user);
    },
    async signIn(rawLoginId, password) {
      // 형식이 틀린 아이디는 있을 수 없으니 서버에 묻지 않고 "맞지 않습니다"로 답한다
      const checked = validateLoginId(rawLoginId);
      if (!checked.ok) throw authError('auth/invalid-credential');
      const { user } = await sdk.signInWithEmailAndPassword(auth, emailOf(checked.loginId), password);
      return toSession(user);
    },
    signOut: () => sdk.signOut(auth),
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
  const toSession = ({ uid, loginId }) => ({ mode: 'dev', uid, loginId, getToken: async () => uid });
  let current = read(DEV_SESSION_KEY, null);
  if (current && !current.loginId) current = null; // 이메일로 저장된 예전 개발 계정은 버린다
  const emit = () => listeners.forEach((listener) => listener(current ? toSession(current) : null));
  const login = (account) => {
    current = { uid: account.uid, loginId: account.loginId };
    write(DEV_SESSION_KEY, current);
    emit();
    return toSession(current);
  };
  const accounts = () => read(DEV_ACCOUNTS_KEY, {});

  return {
    mode: 'dev',
    onChange(listener) {
      listeners.add(listener);
      queueMicrotask(() => listeners.has(listener) && listener(current ? toSession(current) : null));
      return () => listeners.delete(listener);
    },
    async signUp(rawLoginId, password) {
      const loginId = checkLoginId(rawLoginId);
      checkPassword(password);
      const all = accounts();
      if (all[loginId]?.loginId) throw authError('auth/email-already-in-use');
      const salt = randomHex(16);
      const account = { uid: `dev:${randomHex(16)}`, loginId, salt, hash: await digest(`${salt}:${password}`) };
      write(DEV_ACCOUNTS_KEY, { ...all, [loginId]: account });
      return login(account);
    },
    async signIn(rawLoginId, password) {
      const checked = validateLoginId(rawLoginId);
      const account = checked.ok ? accounts()[checked.loginId] : null;
      if (!account?.loginId || account.hash !== (await digest(`${account.salt}:${password}`))) {
        throw authError('auth/invalid-credential');
      }
      return login(account);
    },
    async signOut() {
      current = null;
      write(DEV_SESSION_KEY, null);
      emit();
    },
    /** 가입 화면의 중복 확인 (개발 모드는 계정이 이 브라우저에 있다) */
    async checkLoginId(rawLoginId) {
      const checked = validateLoginId(rawLoginId);
      if (!checked.ok) return { available: false, reason: checked.reason };
      return accounts()[checked.loginId]?.loginId ? { available: false, reason: 'TAKEN' } : { available: true };
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
  const code = err?.code ?? '';
  if (code.startsWith('id/')) return LOGIN_ID_MESSAGES[code.slice(3)] ?? '아이디 형식이 올바르지 않습니다.';
  switch (code) {
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
    case 'auth/email-already-in-use':
      return '이미 있는 아이디입니다. 다른 아이디를 쓰거나 로그인해 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
    case 'auth/invalid-email':
      return '아이디 또는 비밀번호가 맞지 않습니다.';
    case 'auth/too-many-requests':
      return '시도가 너무 많습니다. 잠시 뒤에 다시 해 주세요.';
    case 'auth/user-disabled':
      return '사용이 중지된 계정입니다.';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Firebase 콘솔의 Authentication → 로그인 방법에서 “이메일/비밀번호”를 사용 설정하세요. (아이디 로그인이 이 방식을 씁니다)';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'VITE_FIREBASE_API_KEY가 올바르지 않습니다. client/.env를 확인하세요.';
    case 'auth/network-request-failed':
      return 'Firebase에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
    default:
      return `처리하지 못했습니다 (${err?.code ?? err?.message ?? '알 수 없는 오류'})`;
  }
}
