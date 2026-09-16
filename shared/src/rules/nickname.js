// 닉네임 규칙. 서버가 최종 판정하고, 클라이언트는 입력하는 동안 미리 알려 주는 데 쓴다.

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 한글·영문·숫자·밑줄만 (공백·특수문자는 순위표와 채팅에서 사칭에 쓰이기 쉽다) */
const ALLOWED = /^[\p{Script=Hangul}A-Za-z0-9_]+$/u;

// 운영진 사칭 방지. 한글 직함은 어디에 들어가도 막고, 영어는 짧은 단어가 다른 단어에 섞이기 쉬워
// ("Sigma"의 gm, "badminton"의 admin) 통째로 같을 때만 막는다.
const RESERVED_ANYWHERE = ['관리자', '운영자', '운영진', '시스템', '공지'];
const RESERVED_EXACT = ['admin', 'administrator', 'system', 'gm', 'moderator', 'operator', 'staff'];

export const NICKNAME_ERROR = Object.freeze({
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  INVALID_CHARS: 'INVALID_CHARS',
  RESERVED: 'RESERVED',
  TAKEN: 'TAKEN',
});

/** 대소문자·전각 문자를 같게 보는 비교 키 ("Knight"와 "knight"는 같은 닉네임) */
export const nicknameKey = (nickname) => nickname.normalize('NFKC').toLowerCase();

/**
 * @returns {{ ok: true, nickname: string } | { ok: false, reason: string }}
 */
export function validateNickname(raw) {
  const nickname = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
  const length = [...nickname].length;
  if (length < NICKNAME_MIN) return { ok: false, reason: NICKNAME_ERROR.TOO_SHORT };
  if (length > NICKNAME_MAX) return { ok: false, reason: NICKNAME_ERROR.TOO_LONG };
  if (!ALLOWED.test(nickname)) return { ok: false, reason: NICKNAME_ERROR.INVALID_CHARS };
  const key = nicknameKey(nickname);
  if (RESERVED_ANYWHERE.some((word) => key.includes(word)) || RESERVED_EXACT.includes(key)) {
    return { ok: false, reason: NICKNAME_ERROR.RESERVED };
  }
  return { ok: true, nickname };
}

export const NICKNAME_MESSAGES = Object.freeze({
  [NICKNAME_ERROR.TOO_SHORT]: `닉네임은 ${NICKNAME_MIN}자 이상이어야 합니다.`,
  [NICKNAME_ERROR.TOO_LONG]: `닉네임은 ${NICKNAME_MAX}자까지입니다.`,
  [NICKNAME_ERROR.INVALID_CHARS]: '닉네임에는 한글·영문·숫자·밑줄(_)만 쓸 수 있습니다.',
  [NICKNAME_ERROR.RESERVED]: '쓸 수 없는 단어가 들어 있습니다.',
  [NICKNAME_ERROR.TAKEN]: '이미 쓰고 있는 닉네임입니다.',
});

/** 비밀번호 규칙 (Firebase 최소 6자보다 조금 엄격하게) */
export const PASSWORD_MIN = 8;
