// 게임 전역 상수. 기준: docs/GAME_DESIGN.md, docs/ARCHITECTURE.md

/** 타일 한 칸의 픽셀 크기 */
export const TILE_SIZE = 32;

/** 서버 시뮬레이션 틱 간격 (20Hz) */
export const TICK_MS = 50;

/** 한 방의 최대 인원 (MVP는 1v1) */
export const MAX_PLAYERS = 2;

/** 모두 준비하면 게임 시작까지 기다리는 시간 */
export const START_COUNTDOWN_SEC = 3;

export const NICKNAME_MAX = 16;
export const ROOM_NAME_MAX = 24;

/** 슬롯별 플레이어 색. 0 = P1(왼쪽 아래), 1 = P2(오른쪽 위) */
export const PLAYER_COLORS = ['#d4574c', '#5b8ff0'];
