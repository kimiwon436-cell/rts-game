// 소켓 이벤트 이름과 코드. 서버와 클라이언트가 같은 값을 쓴다.

export const EV = Object.freeze({
  // 클라이언트 → 서버 (로비 이벤트는 ack 콜백으로 응답)
  NET_PING: 'net:ping',
  LOBBY_LIST: 'lobby:list',
  LOBBY_CREATE: 'lobby:create', // { name }
  LOBBY_JOIN: 'lobby:join', // { roomId }
  LOBBY_LEAVE: 'lobby:leave',
  LOBBY_READY: 'lobby:ready', // { ready }
  GAME_CMD: 'game:cmd', // { seq, type, ... } — 응답 없음. 거부되면 GAME_REJECT

  // 서버 → 클라이언트
  LOBBY_UPDATE: 'lobby:update', // RoomSummary[]
  LOBBY_ROOM: 'lobby:room', // RoomDetail | null
  GAME_COUNTDOWN: 'game:countdown', // { seconds } — seconds가 0이면 취소
  GAME_START: 'game:start', // { roomId, mapId, players }
  GAME_SNAP: 'game:snap', // 틱마다 보내는 상태 (shared/src/snapshot.js)
  GAME_REJECT: 'game:reject', // { seq, reason }
  GAME_END: 'game:end', // { winner, reason, durationSec, players }
  GAME_RESUME: 'game:resume', // 끊겼다 돌아온 플레이어에게: { roomId, mapId, players }
  SESSION_REPLACED: 'session:replaced',
});

export const ERR = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_NOT_WAITING: 'ROOM_NOT_WAITING',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
});

export const ROOM_STATUS = Object.freeze({
  WAITING: 'waiting',
  STARTING: 'starting',
  PLAYING: 'playing',
});

/** 게임 명령 종류 */
export const CMD = Object.freeze({
  MOVE: 'move', // { unitIds, x, y } — 타일 좌표(소수)
  STOP: 'stop', // { unitIds }
  GATHER: 'gather', // { unitIds, mineId } 또는 { unitIds, tile }
  RETURN_CARGO: 'returnCargo', // { unitIds }
  PLACE: 'place', // { unitIds, building, x, y }
  CONSTRUCT: 'construct', // { unitIds, buildingId } — 짓다 만 건물 돕기
  CANCEL_BUILD: 'cancelBuild', // { buildingId }
  AGE_UP: 'ageUp', // {}
  CANCEL_AGE_UP: 'cancelAgeUp', // {}
  TRADE: 'trade', // { resource: 'wood' | 'mana', action: 'buy' | 'sell' }
  TRAIN: 'train', // { buildingId, unit } — 생산 대기열에 넣기
  CANCEL_TRAIN: 'cancelTrain', // { buildingId, index }
  SET_RALLY: 'setRally', // { buildingId, x, y } — mineId나 tile을 주면 새 농노가 바로 채집한다
  ATTACK: 'attack', // { unitIds, targetId } — 적 유닛·건물
  ATTACK_MOVE: 'attackMove', // { unitIds, x, y } — 가다가 만나는 적과 싸운다
  TOGGLE_ABILITY: 'toggleAbility', // { unitIds, ability: 'shieldWall' }
  SURRENDER: 'surrender', // {}
});

/** 경기가 끝난 이유 */
export const VICTORY_REASON = Object.freeze({
  CONQUEST: 'conquest', // 왕관 몰락 카운트다운이 끝났다
  ANNIHILATION: 'annihilation', // 유닛도 건물도 남지 않았다
  SURRENDER: 'surrender',
  LEFT: 'left', // 경기 중에 나갔다
});

/** 명령 거부 이유 */
export const REJECT = Object.freeze({
  INVALID: 'INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  NO_WORKER: 'NO_WORKER',
  INVALID_TARGET: 'INVALID_TARGET',
  NOT_ENOUGH_GOLD: 'NOT_ENOUGH_GOLD',
  NOT_ENOUGH_WOOD: 'NOT_ENOUGH_WOOD',
  NOT_ENOUGH_MANA: 'NOT_ENOUGH_MANA',
  REQUIRES_AGE: 'REQUIRES_AGE',
  REQUIRES_BUILDING: 'REQUIRES_BUILDING',
  AGE_IN_PROGRESS: 'AGE_IN_PROGRESS',
  MAX_AGE: 'MAX_AGE',
  NO_MARKET: 'NO_MARKET',
  QUEUE_FULL: 'QUEUE_FULL',
  CANNOT_ATTACK: 'CANNOT_ATTACK',
  // 배치 판정 (shared/src/rules/placement.js의 PLACE와 같은 값)
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  BLOCKED: 'BLOCKED',
  NEEDS_WELL: 'NEEDS_WELL',
  WELL_TAKEN: 'WELL_TAKEN',
  ON_WELL: 'ON_WELL',
});

/** 유닛 상태 코드 (docs/ARCHITECTURE.md 7장) */
export const UNIT_STATE = Object.freeze({
  IDLE: 0,
  MOVE: 1,
  ATTACK: 2,
  GATHER: 3,
  RETURN: 4,
  BUILD: 5,
});

/** 스냅샷의 일회성 이벤트 */
export const GAME_EVENT = Object.freeze({
  TREE_FELLED: 1, // [code, tileIndex]
  MINE_DEPLETED: 2, // [code, mineId]
  BUILT: 3, // [code, buildingId, ownerSlot]
  AGE_UP: 4, // [code, ownerSlot, age]
  TRAINED: 5, // [code, unitId, ownerSlot]
  ATTACK: 6, // [code, attackerId, targetId] — 공격 모션·투사체용
  UNIT_DIED: 7, // [code, unitId]
  BUILDING_DESTROYED: 8, // [code, buildingId]
  CROWN_FALLING: 9, // [code, ownerSlot] — 영주관을 모두 잃어 왕관 몰락 카운트다운 시작
  CROWN_RESTORED: 10, // [code, ownerSlot] — 영주관을 다시 지어 카운트다운 취소
  PLAYER_DEFEATED: 11, // [code, ownerSlot]
});
