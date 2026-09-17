import { BUILDINGS } from '../data/buildings.js';
import { isBuildableTerrain } from '../map/grid.js';

export const PLACE = Object.freeze({
  OK: 'OK',
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  BLOCKED: 'BLOCKED',
  NEEDS_WELL: 'NEEDS_WELL',
  WELL_TAKEN: 'WELL_TAKEN',
  ON_WELL: 'ON_WELL',
});

export const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * 건물을 (x, y)에 놓을 수 있는지 판정한다. 서버 검증과 클라이언트 미리보기가 같은 함수를 쓴다.
 * 자원·시대 조건은 따로 검사한다.
 *
 * @param {object} p
 * @param {string} p.type 건물 종류
 * @param {number} p.x 왼쪽 위 타일
 * @param {number} p.y
 * @param {{ width: number, height: number, wells: Array }} p.map
 * @param {Uint8Array} p.tiles 현재 지형 (나무가 베이면 바뀐다)
 * @param {Uint8Array} p.occupied 건물·건설 부지·금광이 차지한 칸이면 1
 * @param {(wellId: string) => boolean} p.isWellTaken
 * @returns {string} PLACE 값
 */
export function checkPlacement({ type, x, y, map, tiles, occupied, isWellTaken }) {
  const def = BUILDINGS[type];
  const size = def.size;
  const rect = { x, y, w: size, h: size };

  if (x < 0 || y < 0 || x + size > map.width || y + size > map.height) return PLACE.OUT_OF_BOUNDS;

  const well = map.wells.find((w) => rectsOverlap(w, rect));
  if (def.onWell) {
    if (!well || well.x !== x || well.y !== y || well.w !== size) return PLACE.NEEDS_WELL;
    if (isWellTaken(well.id)) return PLACE.WELL_TAKEN;
  } else if (well) {
    return PLACE.ON_WELL;
  }

  for (let ty = y; ty < y + size; ty++) {
    for (let tx = x; tx < x + size; tx++) {
      const i = ty * map.width + tx;
      if (!isBuildableTerrain(tiles[i]) || occupied[i]) return PLACE.BLOCKED; // 물·다리·숲·바위
    }
  }
  return PLACE.OK;
}
