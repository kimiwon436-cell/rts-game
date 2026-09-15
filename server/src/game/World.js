import { UNITS } from '@rune/shared/data/units.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { POP_LIMIT, STARTING_RESOURCES, STARTING_WORKERS, WOOD_PER_TREE } from '@rune/shared/data/economy.js';
import { MARKET } from '@rune/shared/data/market.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { NavGrid } from './pathfinding/NavGrid.js';
import { Pathfinder, toWaypoints } from './pathfinding/astar.js';

/** 유닛 중심이 사각형에서 이 거리(타일) 안이면 "옆에 붙었다"고 본다 */
export const ADJACENT_DISTANCE = 0.95;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 점과 사각형 사이 거리 (타일). 점이 사각형 안이면 0 */
export function distanceToRect(px, py, rect) {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.w));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * 한 경기의 전체 상태. 서버에만 있고 클라이언트는 스냅샷으로 받는다.
 * 좌표: 유닛은 타일 단위 소수(15.5 = 15번 칸 중심), 건물·금광은 왼쪽 위 타일 정수.
 * 소유자(owner)는 플레이어 슬롯 번호다.
 */
export class World {
  constructor(map, players) {
    this.map = map;
    this.width = map.width;
    this.height = map.height;
    this.tick = 0;
    this.nextId = 1;
    this.events = [];

    this.tiles = new Uint8Array(map.tiles);
    this.treeWood = new Uint8Array(this.tiles.length);
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === TERRAIN.TREE) this.treeWood[i] = WOOD_PER_TREE;
    }
    this.nav = new NavGrid(this.width, this.height, this.tiles);
    this.pathfinder = new Pathfinder(this.nav);
    /** 건물·건설 부지·금광이 차지한 칸 (배치 판정용) */
    this.occupied = new Uint8Array(this.tiles.length);

    this.units = new Map();
    this.buildings = new Map();
    this.mines = new Map();
    for (const m of map.goldMines) {
      const mine = { id: m.id, x: m.x, y: m.y, w: m.w, h: m.h, amount: m.amount };
      this.mines.set(mine.id, mine);
      this.setFootprint(mine, 1, true);
    }
    this.wellOwner = new Map(); // wellId → 오벨리스크 buildingId

    this.players = [];
    for (const p of players) {
      this.players[p.slot] = {
        uid: p.uid,
        nickname: p.nickname,
        slot: p.slot,
        ...STARTING_RESOURCES,
        pop: 0,
        popCap: 0,
        age: 1,
        ageTarget: 0,
        ageProgress: 0,
        market: { ...MARKET.basePrice },
      };
    }

    this.spawnStartingForces();
    this.updatePopulation();
  }

  // ---------- 생성과 제거 ----------

  spawnStartingForces() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const player of this.players) {
      if (!player) continue;
      const { keep } = this.map.starts.find((s) => s.slot === player.slot);
      this.spawnBuilding('keep', player.slot, keep.x, keep.y, { complete: true });
      const spots = this.ringTiles(keep)
        .filter(([tx, ty]) => !this.nav.isBlocked(tx, ty))
        .sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [tx, ty] of spots.slice(0, STARTING_WORKERS)) {
        this.spawnUnit('peasant', player.slot, tx + 0.5, ty + 0.5);
      }
    }
  }

  spawnUnit(type, owner, x, y) {
    const unit = {
      id: this.nextId++,
      type,
      owner,
      x,
      y,
      hp: UNITS[type].hp,
      state: UNIT_STATE.IDLE,
      order: null,
      phase: null,
      path: null,
      goal: null,
      navVersion: -1,
      carry: null,
      harvest: 0,
      dropoffId: null,
    };
    this.units.set(unit.id, unit);
    return unit;
  }

  spawnBuilding(type, owner, x, y, { complete = false } = {}) {
    const def = BUILDINGS[type];
    const building = {
      id: this.nextId++,
      type,
      owner,
      x,
      y,
      w: def.size,
      h: def.size,
      maxHp: def.hp,
      hp: complete ? def.hp : Math.max(1, Math.round(def.hp * 0.1)),
      progress: complete ? 1 : 0,
      complete,
      started: complete,
      wellId: null,
    };
    this.buildings.set(building.id, building);
    this.setFootprint(building, 1, complete);
    if (def.onWell) {
      const well = this.map.wells.find((w) => w.x === x && w.y === y);
      if (well) {
        building.wellId = well.id;
        this.wellOwner.set(well.id, building.id);
      }
    }
    return building;
  }

  removeBuilding(building) {
    this.buildings.delete(building.id);
    this.setFootprint(building, 0, building.started);
    if (building.wellId) this.wellOwner.delete(building.wellId);
  }

  /** 건설을 시작한다: 풋프린트를 막고 그 위의 유닛을 밖으로 밀어낸다 */
  startConstruction(building) {
    building.started = true;
    this.nav.setRect(building, 1);
    this.ejectUnits(building);
  }

  /** 풋프린트의 점유(배치 판정)와, affectNav면 막힘(길찾기)도 바꾼다 */
  setFootprint(rect, value, affectNav) {
    for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
      for (let tx = rect.x; tx < rect.x + rect.w; tx++) this.occupied[ty * this.width + tx] = value;
    }
    if (affectNav) this.nav.setRect(rect, value);
  }

  fellTree(tile) {
    this.tiles[tile] = TERRAIN.GRASS;
    this.treeWood[tile] = 0;
    this.nav.setTile(tile, 0);
    this.events.push([GAME_EVENT.TREE_FELLED, tile]);
  }

  depleteMine(mine) {
    this.mines.delete(mine.id);
    this.setFootprint(mine, 0, true);
    this.events.push([GAME_EVENT.MINE_DEPLETED, mine.id]);
  }

  // ---------- 이동 ----------

  /**
   * 유닛을 목표로 보낸다. adjacent면 사각형 옆 칸, 아니면 사각형 안 칸이 목적지다.
   * point를 주면 경로 끝을 그 좌표로 맞춘다 (이동 명령).
   * @returns {boolean} 목표까지 닿는 경로를 찾았는지
   */
  moveUnit(unit, rect, adjacent, point = null) {
    const sx = clamp(Math.floor(unit.x), 0, this.width - 1);
    const sy = clamp(Math.floor(unit.y), 0, this.height - 1);
    const { tiles, reached } = this.pathfinder.find(sx, sy, rect, adjacent);
    const waypoints = toWaypoints(this.nav, unit.x, unit.y, tiles, UNITS[unit.type].radius);
    if (point && reached) {
      if (waypoints.length) waypoints[waypoints.length - 1] = [point.x, point.y];
      else waypoints.push([point.x, point.y]);
    }
    unit.path = waypoints.length ? waypoints : null;
    unit.goal = { rect, adjacent, point };
    unit.navVersion = this.nav.version;
    return reached;
  }

  stopUnit(unit) {
    unit.order = null;
    unit.phase = null;
    unit.path = null;
    unit.goal = null;
    unit.state = UNIT_STATE.IDLE;
  }

  /** 사각형 안에 걸친 유닛을 가장 가까운 빈 칸으로 옮긴다 */
  ejectUnits(rect) {
    for (const unit of this.units.values()) {
      if (distanceToRect(unit.x, unit.y, rect) >= UNITS[unit.type].radius) continue;
      const spot = this.nearestFreeTile(unit.x, unit.y);
      if (!spot) continue;
      unit.x = spot[0] + 0.5;
      unit.y = spot[1] + 0.5;
      unit.navVersion = -1; // 이동 중이었다면 새 위치에서 경로를 다시 찾게 한다
    }
  }

  nearestFreeTile(x, y, maxRadius = 12) {
    const ox = Math.floor(x);
    const oy = Math.floor(y);
    for (let r = 0; r <= maxRadius; r++) {
      let best = null;
      let bestDistance = Infinity;
      for (let ty = oy - r; ty <= oy + r; ty++) {
        for (let tx = ox - r; tx <= ox + r; tx++) {
          if (Math.max(Math.abs(tx - ox), Math.abs(ty - oy)) !== r || this.nav.isBlocked(tx, ty)) continue;
          const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
          if (d < bestDistance) {
            bestDistance = d;
            best = [tx, ty];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // ---------- 조회 ----------

  tileRect(tile) {
    return { x: tile % this.width, y: Math.floor(tile / this.width), w: 1, h: 1 };
  }

  /** 사각형을 한 칸 떨어져 둘러싼 테두리 칸들 */
  ringTiles({ x, y, w, h }) {
    const tiles = [];
    for (let tx = x - 1; tx <= x + w; tx++) tiles.push([tx, y - 1], [tx, y + h]);
    for (let ty = y; ty < y + h; ty++) tiles.push([x - 1, ty], [x + w, ty]);
    return tiles.filter(([tx, ty]) => this.nav.inside(tx, ty));
  }

  /** (cx, cy)에서 radius 안의 나무 칸을 가까운 순서로 */
  treesNear(cx, cy, radius) {
    const found = [];
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * this.width + tx;
        if (this.tiles[i] !== TERRAIN.TREE) continue;
        const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy);
        if (d <= radius) found.push([d, i]);
      }
    }
    return found.sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  }

  nearestDropoff(owner, kind, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || !b.complete || !BUILDINGS[b.type].dropoff?.includes(kind)) continue;
      const d = distanceToRect(x, y, b);
      if (d < bestDistance) {
        bestDistance = d;
        best = b;
      }
    }
    return best;
  }

  hasCompleted(owner, type) {
    for (const b of this.buildings.values()) {
      if (b.owner === owner && b.type === type && b.complete) return true;
    }
    return false;
  }

  isWellTaken(wellId) {
    return this.wellOwner.has(wellId);
  }

  updatePopulation() {
    for (const p of this.players) {
      if (!p) continue;
      p.pop = 0;
      p.popCap = 0;
    }
    for (const u of this.units.values()) this.players[u.owner].pop += UNITS[u.type].pop;
    for (const b of this.buildings.values()) {
      if (b.complete) this.players[b.owner].popCap += BUILDINGS[b.type].pop ?? 0;
    }
    for (const p of this.players) if (p) p.popCap = Math.min(POP_LIMIT, p.popCap);
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
}
