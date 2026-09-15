import { isBlockingTerrain } from '@rune/shared/map/grid.js';

/**
 * 유닛이 지나갈 수 없는 칸: 막힌 지형 + 건설을 시작한 건물 + 금광.
 * 유닛끼리는 칸을 막지 않는다 (서로 밀어내기는 3-3에서).
 */
export class NavGrid {
  constructor(width, height, tiles) {
    this.width = width;
    this.height = height;
    this.blocked = new Uint8Array(width * height);
    for (let i = 0; i < tiles.length; i++) this.blocked[i] = isBlockingTerrain(tiles[i]) ? 1 : 0;
    /**
     * 칸이 새로 막힐 때마다 올라간다. 이동 중인 유닛은 이 값이 바뀌면 경로를 다시 찾는다.
     * (칸이 열리는 것은 기존 경로를 망가뜨리지 않으므로 올리지 않는다)
     */
    this.version = 0;
  }

  inside(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  isBlocked(tx, ty) {
    return !this.inside(tx, ty) || this.blocked[ty * this.width + tx] === 1;
  }

  setTile(index, value) {
    if (this.blocked[index] === value) return;
    this.blocked[index] = value;
    if (value === 1) this.version++;
  }

  setRect({ x, y, w, h }, value) {
    let newlyBlocked = false;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const i = ty * this.width + tx;
        if (this.blocked[i] === value) continue;
        this.blocked[i] = value;
        if (value === 1) newlyBlocked = true;
      }
    }
    if (newlyBlocked) this.version++;
  }
}
