import { TILE_SIZE } from '../constants.js';

// 지형 번호는 스냅샷·리플레이에 그대로 실리므로 새 지형은 뒤에 붙인다
export const TERRAIN = Object.freeze({
  GRASS: 0,
  DIRT: 1,
  WATER: 2, // 강과 바다. 배만 다닌다
  ROCK: 3,
  TREE: 4,
  BRIDGE: 5, // 강 위의 다리. 걷는 유닛은 건너고 배는 밑으로 지나간다. 건물은 못 짓는다
});

export const TERRAIN_NAMES = ['풀밭', '흙바닥', '물', '바위', '나무', '다리'];

/** 걷는 유닛이 지나갈 수 없는 지형인지 */
export function isBlockingTerrain(t) {
  return t === TERRAIN.WATER || t === TERRAIN.ROCK || t === TERRAIN.TREE;
}

/** 배가 다닐 수 있는 지형인지 (물과 다리 밑) */
export function isNavigableWater(t) {
  return t === TERRAIN.WATER || t === TERRAIN.BRIDGE;
}

/** 건물을 지을 수 있는 지형인지 */
export function isBuildableTerrain(t) {
  return t === TERRAIN.GRASS || t === TERRAIN.DIRT;
}

export const tileToWorld = (t) => t * TILE_SIZE;
export const worldToTile = (w) => Math.floor(w / TILE_SIZE);

/** 타일 풋프린트 { x, y, w, h }의 중심 월드 좌표 */
export function footprintCenter({ x, y, w, h }) {
  return { x: (x + w / 2) * TILE_SIZE, y: (y + h / 2) * TILE_SIZE };
}
