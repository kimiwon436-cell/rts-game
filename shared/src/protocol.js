// 소켓 이벤트 이름과 오류 코드. 서버와 클라이언트가 같은 값을 쓴다.

export const EV = Object.freeze({
  // 클라이언트 → 서버 (모두 ack 콜백으로 응답)
  NET_PING: 'net:ping',
  LOBBY_LIST: 'lobby:list',
  LOBBY_CREATE: 'lobby:create', // { name }
  LOBBY_JOIN: 'lobby:join', // { roomId }
  LOBBY_LEAVE: 'lobby:leave',
  LOBBY_READY: 'lobby:ready', // { ready }

  // 서버 → 클라이언트
  LOBBY_UPDATE: 'lobby:update', // RoomSummary[]
  LOBBY_ROOM: 'lobby:room', // RoomDetail | null
  GAME_COUNTDOWN: 'game:countdown', // { seconds } — seconds가 0이면 취소
  GAME_START: 'game:start', // { roomId, mapId, players }
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
