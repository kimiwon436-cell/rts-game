import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';
import { decodeBuilding, decodePlayer, decodeUnit } from '@rune/shared/snapshot.js';

/** 그리는 위치가 서버 위치를 따라잡는 속도. 3-5에서 스냅샷 보간으로 바꾼다. */
const SMOOTHING_PER_SEC = 18;
const TELEPORT_DISTANCE = 3;

/**
 * 서버 스냅샷으로 만든 클라이언트 쪽 세계. 규칙은 판정하지 않고 보여주기와 선택에만 쓴다.
 * 좌표는 타일 단위 (서버와 같다).
 */
export class ClientWorld {
  constructor(map, mySlot) {
    this.map = map;
    this.mySlot = mySlot;
    this.tiles = new Uint8Array(map.tiles);
    this.units = new Map();
    this.buildings = new Map();
    this.mineAmounts = new Map(map.goldMines.map((m) => [m.id, m.amount]));
    this.me = null;
    this.ages = new Map(); // slot → age
    this.tick = -1;
    this.occupied = new Uint8Array(map.tiles.length);
    this.occupancyDirty = true;
    /** @type {(tile: number) => void} */
    this.onTreeFelled = null;
    /** @type {(event: Array) => void} */
    this.onEvent = null;
  }

  get ready() {
    return this.me !== null;
  }

  applySnapshot(snap) {
    this.tick = snap.t;
    this.me = decodePlayer(snap.me);
    for (const [slot, age] of snap.players) this.ages.set(slot, age);

    const unitIds = new Set();
    for (const raw of snap.units) {
      const data = decodeUnit(raw);
      unitIds.add(data.id);
      const unit = this.units.get(data.id);
      if (unit) Object.assign(unit, data);
      else this.units.set(data.id, { ...data, drawX: data.x, drawY: data.y });
    }
    for (const id of this.units.keys()) if (!unitIds.has(id)) this.units.delete(id);

    const buildingIds = new Set();
    for (const raw of snap.buildings) {
      const data = decodeBuilding(raw);
      buildingIds.add(data.id);
      const building = this.buildings.get(data.id);
      if (building) {
        Object.assign(building, data);
      } else {
        this.buildings.set(data.id, { ...data, size: BUILDINGS[data.type].size });
        this.occupancyDirty = true;
      }
    }
    for (const id of this.buildings.keys()) {
      if (!buildingIds.has(id)) {
        this.buildings.delete(id);
        this.occupancyDirty = true;
      }
    }

    const mineIds = new Set();
    for (const [id, amount] of snap.mines) {
      mineIds.add(id);
      this.mineAmounts.set(id, amount);
    }
    for (const id of this.mineAmounts.keys()) {
      if (!mineIds.has(id)) {
        this.mineAmounts.delete(id);
        this.occupancyDirty = true;
      }
    }

    for (const event of snap.ev) {
      if (event[0] === GAME_EVENT.TREE_FELLED) {
        this.tiles[event[1]] = TERRAIN.GRASS;
        this.onTreeFelled?.(event[1]);
      }
      this.onEvent?.(event);
    }
  }

  /** 그리는 위치를 서버 위치 쪽으로 부드럽게 옮긴다 */
  updateDrawPositions(dt) {
    const k = 1 - Math.exp(-SMOOTHING_PER_SEC * dt);
    for (const unit of this.units.values()) {
      const dx = unit.x - unit.drawX;
      const dy = unit.y - unit.drawY;
      if (Math.abs(dx) > TELEPORT_DISTANCE || Math.abs(dy) > TELEPORT_DISTANCE) {
        unit.drawX = unit.x;
        unit.drawY = unit.y;
      } else {
        unit.drawX += dx * k;
        unit.drawY += dy * k;
      }
    }
  }

  // ---------- 조회 ----------

  isMine(entity) {
    return entity.owner === this.mySlot;
  }

  terrainAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return -1;
    return this.tiles[ty * this.map.width + tx];
  }

  /** 점(타일 좌표) 가까이에 있는 유닛. 내 유닛을 먼저 고른다 */
  unitAt(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const unit of this.units.values()) {
      const d = Math.hypot(unit.drawX - x, unit.drawY - y);
      if (d > UNITS[unit.type].radius + 0.3) continue;
      const score = d - (this.isMine(unit) ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = unit;
      }
    }
    return best;
  }

  buildingAt(x, y) {
    for (const b of this.buildings.values()) {
      if (x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size) return b;
    }
    return null;
  }

  mineAt(x, y) {
    return (
      this.map.goldMines.find(
        (m) => this.mineAmounts.has(m.id) && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h,
      ) ?? null
    );
  }

  /** 사각형(타일 좌표) 안의 내 유닛 */
  myUnitsInRect(x0, y0, x1, y1) {
    const [minX, maxX] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [minY, maxY] = y0 < y1 ? [y0, y1] : [y1, y0];
    return [...this.units.values()].filter(
      (u) => this.isMine(u) && u.drawX >= minX && u.drawX <= maxX && u.drawY >= minY && u.drawY <= maxY,
    );
  }

  /** 배치 미리보기용 점유 칸 (건물·부지·금광) */
  getOccupied() {
    if (!this.occupancyDirty) return this.occupied;
    const { width } = this.map;
    this.occupied.fill(0);
    const mark = (x, y, w, h) => {
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.occupied[ty * width + tx] = 1;
    };
    for (const b of this.buildings.values()) mark(b.x, b.y, b.size, b.size);
    for (const m of this.map.goldMines) if (this.mineAmounts.has(m.id)) mark(m.x, m.y, m.w, m.h);
    this.occupancyDirty = false;
    return this.occupied;
  }

  isWellTaken(wellId) {
    const well = this.map.wells.find((w) => w.id === wellId);
    for (const b of this.buildings.values()) {
      if (b.type === 'obelisk' && b.x === well.x && b.y === well.y) return true;
    }
    return false;
  }

  hasCompleted(type) {
    for (const b of this.buildings.values()) {
      if (b.owner === this.mySlot && b.type === type && b.complete) return true;
    }
    return false;
  }
}
