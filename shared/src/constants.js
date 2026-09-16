// 게임 전역 상수. 기준: docs/GAME_DESIGN.md, docs/ARCHITECTURE.md

/** 타일 한 칸의 픽셀 크기 */
export const TILE_SIZE = 32;

/** 서버 시뮬레이션 틱 간격 (20Hz) */
export const TICK_MS = 50;

/** 모두 준비하면 게임 시작까지 기다리는 시간 */
export const START_COUNTDOWN_SEC = 3;

export { NICKNAME_MAX } from './rules/nickname.js';
export const ROOM_NAME_MAX = 24;

/**
 * 슬롯별 플레이어 색. 짝수 슬롯(팀 0, 왼쪽 아래)은 따뜻한 색, 홀수 슬롯(팀 1, 오른쪽 위)은 차가운 색이라
 * 팀전에서도 색만 보고 편을 알 수 있다.
 */
export const PLAYER_COLORS = ['#d4574c', '#5b8ff0', '#e0913a', '#3fb5a6', '#c9609f', '#8f7ee8'];
