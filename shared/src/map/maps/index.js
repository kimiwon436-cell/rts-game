import { createDuel01 } from './duel01.js';
import { createDuel02 } from './duel02.js';
import { createTeam01 } from './team01.js';
import { createTeam02 } from './team02.js';

const factories = { duel01: createDuel01, duel02: createDuel02, team01: createTeam01, team02: createTeam02 };
const cache = new Map();

/** 경기 방식: 팀당 인원 */
export const GAME_MODES = Object.freeze({
  '1v1': Object.freeze({ id: '1v1', name: '1대1', teamSize: 1 }),
  '2v2': Object.freeze({ id: '2v2', name: '2대2', teamSize: 2 }),
  '3v3': Object.freeze({ id: '3v3', name: '3대3', teamSize: 3 }),
});
export const MODE_IDS = Object.freeze(Object.keys(GAME_MODES));

/** 맵 목록 (방 설정 화면용). 지형은 loadMap으로 만든다 */
export const MAP_LIST = Object.freeze([
  { id: 'duel01', name: '갈라진 레이 라인', mode: '1v1' },
  { id: 'duel02', name: '얼어붙은 강', mode: '1v1' },
  { id: 'team01', name: '쌍둥이 협곡', mode: '2v2' },
  { id: 'team02', name: '왕관의 평원', mode: '3v3' },
]);

export const DEFAULT_MAP_ID = 'duel01';
export const defaultMapFor = (mode) => MAP_LIST.find((m) => m.mode === mode)?.id ?? DEFAULT_MAP_ID;
export const mapsForMode = (mode) => MAP_LIST.filter((m) => m.mode === mode);

export const hasMap = (mapId) => Object.hasOwn(factories, mapId);

/** mapId로 맵을 만든다. 한 번 만든 맵은 캐시하므로 지형 배열은 읽기 전용으로 쓴다. */
export function loadMap(mapId) {
  if (!hasMap(mapId)) throw new Error(`알 수 없는 맵: ${mapId}`);
  if (!cache.has(mapId)) cache.set(mapId, factories[mapId]());
  return cache.get(mapId);
}
