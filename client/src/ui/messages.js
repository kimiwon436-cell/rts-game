import { ERR, REJECT } from '@rune/shared/protocol.js';

const MESSAGES = {
  // 로비
  [ERR.UNAUTHORIZED]: '로그인 정보를 확인할 수 없습니다. 서버와 클라이언트가 같은 인증 방식(Firebase 또는 개발 모드)인지 확인하세요.',
  [ERR.INVALID_PAYLOAD]: '요청 형식이 올바르지 않습니다.',
  [ERR.ROOM_NOT_FOUND]: '방이 사라졌습니다. 목록에서 다른 방을 고르세요.',
  [ERR.ROOM_FULL]: '방이 가득 찼습니다.',
  [ERR.ROOM_NOT_WAITING]: '이미 게임이 시작된 방입니다.',
  [ERR.NOT_IN_ROOM]: '참가 중인 방이 없습니다.',
  TIMEOUT: '서버가 응답하지 않습니다. 연결 상태를 확인하세요.',

  // 게임 명령
  [REJECT.INVALID]: '명령을 처리할 수 없습니다.',
  [REJECT.RATE_LIMITED]: '명령을 너무 빠르게 보내고 있습니다.',
  [REJECT.NO_WORKER]: '농노를 선택하세요.',
  [REJECT.INVALID_TARGET]: '그 대상에는 명령할 수 없습니다.',
  [REJECT.NOT_ENOUGH_GOLD]: '금이 부족합니다.',
  [REJECT.NOT_ENOUGH_WOOD]: '목재가 부족합니다.',
  [REJECT.NOT_ENOUGH_MANA]: '마나가 부족합니다.',
  [REJECT.REQUIRES_AGE]: '더 높은 시대가 필요합니다.',
  [REJECT.REQUIRES_BUILDING]: '필요한 건물을 먼저 지어야 합니다.',
  [REJECT.AGE_IN_PROGRESS]: '이미 시대를 발전하고 있습니다.',
  [REJECT.MAX_AGE]: '더 발전할 수 없습니다.',
  [REJECT.NO_MARKET]: '완성된 시장이 필요합니다.',
  [REJECT.QUEUE_FULL]: '생산 대기열이 가득 찼습니다.',
  [REJECT.CANNOT_ATTACK]: '선택한 유닛으로는 그 대상을 공격할 수 없습니다.',
  [REJECT.OUT_OF_BOUNDS]: '맵 밖에는 지을 수 없습니다.',
  [REJECT.BLOCKED]: '그 자리는 막혀 있습니다.',
  [REJECT.NEEDS_WELL]: '룬 오벨리스크는 마나 샘 위에만 지을 수 있습니다.',
  [REJECT.WELL_TAKEN]: '이미 오벨리스크가 선 마나 샘입니다.',
  [REJECT.ON_WELL]: '마나 샘 위에는 룬 오벨리스크만 지을 수 있습니다.',
};

export const errorMessage = (code) => MESSAGES[code] ?? `알 수 없는 오류입니다 (${code})`;
