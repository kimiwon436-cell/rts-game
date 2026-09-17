// 소켓 이벤트 이름과 코드. 서버와 클라이언트가 같은 값을 쓴다.

export const EV = Object.freeze({
  // 클라이언트 → 서버 (로비 이벤트는 ack 콜백으로 응답)
  NET_PING: 'net:ping',
  PROFILE_CREATE: 'profile:create', // { nickname } — 가입 직후 한 번
  LOBBY_LIST: 'lobby:list',
  LOBBY_CREATE: 'lobby:create', // { name, mode: '1v1' | '2v2' | '3v3' }
  LOBBY_JOIN: 'lobby:join', // { roomId }
  LOBBY_LEAVE: 'lobby:leave',
  LOBBY_READY: 'lobby:ready', // { ready }
  LOBBY_TEAM: 'lobby:team', // { team: 0 | 1 }
  LOBBY_SETTINGS: 'lobby:settings', // { mode?, mapId? } — 방장만
  RANKED_JOIN: 'ranked:join', // { mode } — 랭킹전 매칭 대기열에 들어간다
  RANKED_LEAVE: 'ranked:leave',
  RANKED_LEADERBOARD: 'ranked:leaderboard', // { mode } → { entries, me }
  CHAT_SEND: 'chat:send', // { text, scope: 'all' | 'team' } — 방(대기실·경기) 안에서만
  GAME_CMD: 'game:cmd', // { seq, type, ... } — 응답 없음. 거부되면 GAME_REJECT

  // 서버 → 클라이언트
  SESSION_PROFILE: 'session:profile', // 접속하자마자: 프로필 | null (null이면 닉네임부터 정한다)
  LOBBY_UPDATE: 'lobby:update', // RoomSummary[]
  LOBBY_ROOM: 'lobby:room', // RoomDetail | null
  GAME_COUNTDOWN: 'game:countdown', // { seconds } — seconds가 0이면 취소
  GAME_START: 'game:start', // { roomId, mapId, mode, ranked, players: [{ uid, nickname, slot, team }] }
  GAME_SNAP: 'game:snap', // 틱마다 보내는 상태 (shared/src/snapshot.js)
  GAME_REJECT: 'game:reject', // { seq, reason }
  GAME_END: 'game:end', // { winnerTeam, reason, durationSec, mode, ranked, players, ratings? }
  GAME_RESUME: 'game:resume', // 끊겼다 돌아온 플레이어에게: { roomId, mapId, players }
  SESSION_REPLACED: 'session:replaced',
  RANKED_STATUS: 'ranked:status', // { mode, waitingSec, queueSize } | null (대기열에서 나왔다)
  RANKED_FOUND: 'ranked:found', // { mode, mapId } — 곧 LOBBY_ROOM·GAME_COUNTDOWN이 온다
  RANKED_RESULT: 'ranked:result', // { mode, changes: [{ nickname, team, before, after, delta, won }] }
  CHAT_MESSAGE: 'chat:message', // { id, scope, text, at, from: { nickname, team, slot } | null(안내) }
  CHAT_HISTORY: 'chat:history', // { roomId, messages } — 방에 들어오거나 다시 접속했을 때
});

export const ERR = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_NOT_WAITING: 'ROOM_NOT_WAITING',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  IN_ROOM: 'IN_ROOM', // 방에 있는 동안은 매칭을 시작할 수 없다
  MATCH_CANCELLED: 'MATCH_CANCELLED', // 시작 전에 누가 나가 매칭이 취소됐다 (다시 대기열로)
  CHAT_RATE_LIMITED: 'CHAT_RATE_LIMITED',
  CHAT_EMPTY: 'CHAT_EMPTY',
  TEAM_FULL: 'TEAM_FULL',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  NO_PROFILE: 'NO_PROFILE', // 닉네임을 정하기 전에는 로비를 쓸 수 없다
  PROFILE_EXISTS: 'PROFILE_EXISTS',
  NICKNAME_INVALID: 'NICKNAME_INVALID', // 자세한 이유는 응답의 reason
  NICKNAME_TAKEN: 'NICKNAME_TAKEN',
  UNAVAILABLE: 'UNAVAILABLE', // 저장소 오류 등 잠시 뒤 다시 시도
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
  TOGGLE_ABILITY: 'toggleAbility', // { unitIds, ability: 'shieldWall' | 'root' } — 켜고 끄기
  USE_ABILITY: 'useAbility', // { unitIds, ability, x, y } — 땅을 찍어 쓰거나 바로 쓴다
  BOARD: 'board', // { unitIds, targetId } — 아르카논 등에 태우기
  TAKE_OATH: 'takeOath', // { oath: 'crown' | 'rune' | 'earth' } — 한 경기에 한 번
  SEND_RESOURCES: 'sendResources', // { to: 팀원 슬롯, resource: 'gold' | 'wood' | 'mana', amount } — 수수료를 떼고 도착한다
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
  OATH_ALREADY_TAKEN: 'OATH_ALREADY_TAKEN',
  REQUIRES_OATH: 'REQUIRES_OATH',
  ULTIMATE_EXISTS: 'ULTIMATE_EXISTS',
  ON_COOLDOWN: 'ON_COOLDOWN',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  GARRISON_FULL: 'GARRISON_FULL',
  CANNOT_BOARD: 'CANNOT_BOARD',
  NO_LANDING: 'NO_LANDING', // 배에서 내리려면 뭍 가까이 대야 한다
  // 배치 판정 (shared/src/rules/placement.js의 PLACE와 같은 값)
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  BLOCKED: 'BLOCKED',
  NEEDS_WELL: 'NEEDS_WELL',
  WELL_TAKEN: 'WELL_TAKEN',
  ON_WELL: 'ON_WELL',
  NEEDS_COAST: 'NEEDS_COAST',
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
  OATH_TAKEN: 12, // [code, ownerSlot, oathIndex] — 전역 공지
  ABILITY: 13, // [code, unitId, abilityIndex, x16, y16] — 능력 사용 효과 (x·y는 대상 지점)
  ULTIMATE_REVIVED: 14, // [code, unitId, ownerSlot] — 솔라리온 부활
  ULTIMATE_LOST: 15, // [code, ownerSlot, unitTypeIndex] — 궁극 유닛이 쓰러졌다
  RESOURCES_SENT: 16, // [code, fromSlot, toSlot, resourceIndex, sent, received] — 보낸 사람의 팀에게만
});
