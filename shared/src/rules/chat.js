// 채팅 규칙. 서버가 최종으로 거르고, 클라이언트는 입력 칸 길이 제한에 쓴다.

export const CHAT_MAX = 150;
export const CHAT_HISTORY = 50;
/** 도배 제한: 이 시간(ms) 안에 이만큼까지 */
export const CHAT_BURST = Object.freeze({ count: 5, windowMs: 5000 });

export const CHAT_SCOPE = Object.freeze({ ALL: 'all', TEAM: 'team' });

/**
 * 욕설 가리기 목록 (자주 쓰는 것만). 글자 사이에 공백·기호를 끼워 넣어도 잡는다.
 * 운영하면서 늘리면 된다.
 */
const PROFANITY = ['씨발', '시발', 'ㅅㅂ', '병신', 'ㅂㅅ', '좆', '개새끼', 'fuck', 'shit', 'bitch'];

// 글자 사이에 끼운 공백·마침표·밑줄·별표·물결·빼기를 건너뛴다 (cleanChat이 모든 공백을 보통 공백으로 바꿔 둔다).
// 목록의 단어에는 정규식 특수 문자가 없어서 따로 이스케이프하지 않는다.
const SEPARATORS = '[ ._*~-]*';
const PATTERNS = PROFANITY.map((word) => new RegExp([...word].join(SEPARATORS), 'giu'));

/** 보이지 않는 문자: 제어 문자(0–31, 127)와 제로폭 문자(U+200B–U+200F) */
const isInvisible = (code) => code < 32 || code === 127 || (code >= 0x200b && code <= 0x200f);

/** 보이지 않는 문자를 공백으로, 연속 공백을 하나로, 앞뒤 공백을 자르고, 최대 길이로 자른다 */
export function cleanChat(value) {
  if (typeof value !== 'string') return '';
  let text = '';
  for (const ch of value) text += isInvisible(ch.codePointAt(0)) ? ' ' : ch;
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, CHAT_MAX).join('');
}

/** 욕설을 같은 길이의 *로 가린다 */
export function maskProfanity(text) {
  let masked = text;
  for (const pattern of PATTERNS) masked = masked.replace(pattern, (m) => '*'.repeat([...m].length));
  return masked;
}
