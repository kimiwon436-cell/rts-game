import { createDuel01 } from './duel01.js';

const factories = { duel01: createDuel01 };
const cache = new Map();

export const DEFAULT_MAP_ID = 'duel01';

export const hasMap = (mapId) => Object.hasOwn(factories, mapId);

/** mapId로 맵을 만든다. 한 번 만든 맵은 캐시하므로 지형 배열은 읽기 전용으로 쓴다. */
export function loadMap(mapId) {
  if (!hasMap(mapId)) throw new Error(`알 수 없는 맵: ${mapId}`);
  if (!cache.has(mapId)) cache.set(mapId, factories[mapId]());
  return cache.get(mapId);
}
