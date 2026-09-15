import { ERR } from '@rune/shared/protocol.js';

const MESSAGES = {
  [ERR.UNAUTHORIZED]: '로그인 정보를 확인할 수 없습니다. 서버와 클라이언트가 같은 인증 방식(Firebase 또는 개발 모드)인지 확인하세요.',
  [ERR.INVALID_PAYLOAD]: '요청 형식이 올바르지 않습니다.',
  [ERR.ROOM_NOT_FOUND]: '방이 사라졌습니다. 목록에서 다른 방을 고르세요.',
  [ERR.ROOM_FULL]: '방이 가득 찼습니다.',
  [ERR.ROOM_NOT_WAITING]: '이미 게임이 시작된 방입니다.',
  [ERR.NOT_IN_ROOM]: '참가 중인 방이 없습니다.',
  TIMEOUT: '서버가 응답하지 않습니다. 연결 상태를 확인하세요.',
};

export const errorMessage = (code) => MESSAGES[code] ?? `알 수 없는 오류입니다 (${code})`;
