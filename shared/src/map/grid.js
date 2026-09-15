import { TILE_SIZE } from '../constants.js';

export const TERRAIN = Object.freeze({
  GRASS: 0,
  DIRT: 1,
  WATER: 2,
  ROCK: 3,
  TREE: 4,
});

export const TERRAIN_NAMES = ['풀밭', '흙바닥', '물', '바위', '나무'];

/** 유닛이 지나갈 수 없는 지형인지 */
export function isBlockingTerrain(t) {
  return t === TERRAIN.WATER || t === TERRAIN.ROCK || t === TERRAIN.TREE;
}

export const tileToWorld = (t) => t * TILE_SIZE;
export const worldToTile = (w) => Math.floor(w / TILE_SIZE);

/** 타일 풋프린트 { x, y, w, h }의 중심 월드 좌표 */
export function footprintCenter({ x, y, w, h }) {
  return { x: (x + w / 2) * TILE_SIZE, y: (y + h / 2) * TILE_SIZE };
}
