// 로그인 아이디 규칙. 아이디는 로그인에만 쓰고, 게임 화면·순위표·채팅에는 닉네임이 보인다.

export const LOGIN_ID_MIN = 4;
export const LOGIN_ID_MAX = 16;

const ALLOWED = /^[a-z0-9_]+$/;

export const LOGIN_ID_ERROR = Object.freeze({
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  INVALID_CHARS: 'INVALID_CHARS',
  TAKEN: 'TAKEN',
});

export const LOGIN_ID_MESSAGES = Object.freeze({
  [LOGIN_ID_ERROR.TOO_SHORT]: `아이디는 ${LOGIN_ID_MIN}자 이상이어야 합니다.`,
  [LOGIN_ID_ERROR.TOO_LONG]: `아이디는 ${LOGIN_ID_MAX}자까지입니다.`,
  [LOGIN_ID_ERROR.INVALID_CHARS]: '아이디에는 영문·숫자·밑줄(_)만 쓸 수 있습니다.',
  [LOGIN_ID_ERROR.TAKEN]: '이미 있는 아이디입니다.',
});

/** 대소문자를 구분하지 않는다: 앞뒤 공백을 자르고 소문자로 */
export const normalizeLoginId = (raw) => String(raw ?? '').trim().toLowerCase();

/** @returns {{ ok: true, loginId: string } | { ok: false, reason: string }} */
export function validateLoginId(raw) {
  const loginId = normalizeLoginId(raw);
  if (loginId.length < LOGIN_ID_MIN) return { ok: false, reason: LOGIN_ID_ERROR.TOO_SHORT };
  if (loginId.length > LOGIN_ID_MAX) return { ok: false, reason: LOGIN_ID_ERROR.TOO_LONG };
  if (!ALLOWED.test(loginId)) return { ok: false, reason: LOGIN_ID_ERROR.INVALID_CHARS };
  return { ok: true, loginId };
}

/**
 * Firebase의 비밀번호 로그인은 이메일 형식을 요구해서, 아이디를 사용자에게 보이지 않는 내부 주소로 바꿔 쓴다.
 * 프로젝트 전용 도메인(<프로젝트ID>.firebaseapp.com) 아래라 다른 사람이 이 주소를 가질 수 없고, 메일도 오가지 않는다.
 * 프로젝트 ID는 바뀌지 않으므로 같은 아이디는 늘 같은 주소가 된다.
 */
export const loginIdToEmail = (loginId, projectId) => `${normalizeLoginId(loginId)}@id.${projectId}.firebaseapp.com`;

/** 내부 주소에서 아이디만 꺼낸다 */
export const emailToLoginId = (email) => String(email ?? '').split('@')[0];
