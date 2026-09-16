import { ERR } from '@rune/shared/protocol.js';
import { verifyIdToken } from '../firebase.js';

const DEV_TOKEN = /^dev:[A-Za-z0-9-]{8,64}$/;

/** 제어 문자(코드 0–31, 127)를 지우고 앞뒤 공백을 자른 뒤 최대 길이로 자른다. */
export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  let text = '';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) text += ch;
  }
  return text.trim().slice(0, maxLength);
}

/**
 * Socket.IO 핸드셰이크의 토큰을 검증하고 socket.data에 uid와 프로필을 넣는다.
 * - firebase 모드: Firebase ID 토큰만 통과 (이메일·비밀번호로 로그인한 계정)
 * - dev 모드: "dev:<무작위 id>" 형식의 게스트 토큰을 uid로 그대로 쓴다 (로컬 개발 전용)
 *
 * 닉네임은 더 이상 클라이언트가 보내지 않는다. 서버에 저장된 프로필의 닉네임만 쓴다.
 * 프로필이 없으면(가입 직후) null로 두고, 로비가 닉네임부터 정하게 한다.
 */
export function createAuthMiddleware(authMode, profiles) {
  return async (socket, next) => {
    const { token } = socket.handshake.auth ?? {};
    let uid;
    try {
      if (typeof token !== 'string' || token.length === 0) throw new Error('토큰이 없습니다');
      if (authMode === 'firebase') {
        uid = await verifyIdToken(token);
      } else if (DEV_TOKEN.test(token)) {
        uid = token;
      } else {
        throw new Error('개발 모드 서버에는 게스트 토큰(dev:...)만 쓸 수 있습니다');
      }
    } catch (err) {
      console.warn(`[인증 실패] ${socket.handshake.address} — ${err.message}`);
      next(new Error(ERR.UNAUTHORIZED));
      return;
    }

    try {
      const profile = await profiles.get(uid);
      socket.data.uid = uid;
      socket.data.profile = profile;
      socket.data.nickname = profile?.nickname ?? null;
      next();
    } catch (err) {
      console.error('[프로필 읽기 실패]', uid, err);
      next(new Error(ERR.UNAVAILABLE));
    }
  };
}
