import { UNITS } from '@rune/shared/data/units.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { ABILITIES } from '@rune/shared/data/abilities.js';
import { POP_LIMIT, STARTING_RESOURCES, STARTING_WORKERS, WOOD_PER_TREE } from '@rune/shared/data/economy.js';
import { MARKET } from '@rune/shared/data/market.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { VisionGrid } from '@rune/shared/rules/vision.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { NavGrid } from './pathfinding/NavGrid.js';
import { Pathfinder, toWaypoints } from './pathfinding/astar.js';

/** 유닛 중심이 사각형에서 이 거리(타일) 안이면 "옆에 붙었다"고 본다 */
export const ADJACENT_DISTANCE = 0.95;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

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
    /** 경로 계산을 기다리는 유닛 id (processPathQueue가 틱마다 예산만큼 처리) */
    this.pathQueue = [];
    /** 틱마다 다시 채우는 유닛 공간 색인 (separation.js·combat.js가 처음 쓸 때 만든다) */
    this.bodyGrid = null;
    this.combatGrid = null;
    this.scratchUnits = []; // 색인을 만들 때 쓰는 재사용 배열
    /** 경기 결과. 정해지면 { winner, reason, tick } */
    this.result = null;

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
    const teams = Math.max(2, ...players.map((p) => (p.team ?? p.slot) + 1));
    /** 전장의 안개: 팀별 시야 (systems/vision.js가 틱마다 갱신한다) */
    this.vision = new VisionGrid(this.width, this.height, { teams });
    /** 팀마다 한 번이라도 본 적 건물 id (안개 속에서도 공격 명령을 받는다) */
    this.knownBuildings = Array.from({ length: teams }, () => new Set());
    for (const p of players) {
      this.players[p.slot] = {
        uid: p.uid,
        nickname: p.nickname,
        slot: p.slot,
        team: p.team ?? p.slot, // 1v1이면 슬롯이 곧 팀이다
        ...STARTING_RESOURCES,
        pop: 0,
        popCap: 0,
        age: 1,
        ageTarget: 0,
        ageProgress: 0,
        market: { ...MARKET.basePrice },
        collapseAt: null, // 왕관 몰락 카운트다운이 끝나는 틱
        defeated: false,
        defeatReason: null,
        oath: null, // 'crown' | 'rune' | 'earth' — 한 번 맺으면 바꿀 수 없다
        revive: null, // 솔라리온 부활 대기 { type, atTick }
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
      pathPending: false,
      cooldown: 0, // 다음 공격까지 남은 초
      combatTargetId: null, // 싸우는 중인 적
      autoTarget: false, // 스스로 고른 적이면 너무 멀어질 때 포기한다
      chaseTick: -1,
      lastAttackerId: null, // 마지막으로 나를 때린 적 (반격용)
      shieldWall: false,
      carrierId: null, // 아르카논 등에 타고 있으면 그 id

      // 능력·상태 (abilities.js가 관리한다)
      cooldowns: {}, // ability → 다시 쓸 수 있는 틱
      stunUntil: 0,
      slowUntil: 0,
      channel: null, // { ability, endTick, x, y }
      rooted: false,
      rootingUntil: 0, // 뿌리내리는·뽑는 중이면 끝나는 틱
      rootingTo: false,
      garrison: [], // 등에 태운 유닛 id (아르카논)
      queue: [], // 뿌리내린 아르카논의 생산 대기열
      aura: null, // 이번 틱에 받는 오라 { damage, resist }

      // 스냅샷에 나가는 파생 값
      stunned: false,
      slowed: false,
      rooting: false,
      channeling: false,
      buffed: false,
      extra: 0,
      revealUntil: null, // 공격해서 맞은 팀에게 드러나 있는 틱 [팀별]
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
      queue: [], // 생산 대기열 [{ type, progress, blocked }]
      rally: null, // 집결지 { x, y, mineId, tile }
      cooldown: 0, // 감시탑 공격 간격
      combatTargetId: null,
      revealUntil: null,
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
    for (const known of this.knownBuildings) known.delete(building.id);
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
    unit.pathPending = false;
    unit.combatTargetId = null;
    unit.autoTarget = false;
    unit.state = UNIT_STATE.IDLE;
  }

  /** 경로 계산을 요청한다. 차례가 올 때까지 유닛은 제자리에서 기다린다. */
  requestPath(unit, goal) {
    unit.goal = goal;
    unit.path = null;
    if (unit.pathPending) return;
    unit.pathPending = true;
    this.pathQueue.push(unit.id);
  }

  /**
   * 쌓인 경로 요청을 처리한다. 한 틱에 maxCount번, maxMs 밀리초까지만 계산하고 나머지는 다음 틱으로 넘긴다.
   * (무리 이동 명령 한 번에 수십 번의 A*가 몰려도 틱이 밀리지 않게)
   * @returns {number} 이번에 처리한 요청 수
   */
  processPathQueue(maxCount, maxMs) {
    const started = performance.now();
    let processed = 0;
    while (this.pathQueue.length && processed < maxCount && performance.now() - started < maxMs) {
      const unit = this.units.get(this.pathQueue.shift());
      if (!unit?.pathPending) continue;
      unit.pathPending = false;
      const { rect, adjacent, point } = unit.goal;
      this.moveUnit(unit, rect, adjacent, point);
      processed++;
    }
    return processed;
  }

  /** 건물 둘레의 빈 칸에 유닛을 만든다. toward(집결지나 맵 중앙)에 가까운 칸을 고른다. */
  spawnUnitNear(type, owner, building, toward) {
    for (let r = 1; r <= 4; r++) {
      const ring = { x: building.x - r + 1, y: building.y - r + 1, w: building.w + 2 * (r - 1), h: building.h + 2 * (r - 1) };
      const spots = this.ringTiles(ring).filter(([tx, ty]) => !this.nav.isBlocked(tx, ty));
      if (!spots.length) continue;
      const distance = ([tx, ty]) => Math.hypot(tx + 0.5 - toward.x, ty + 0.5 - toward.y);
      spots.sort((a, b) => distance(a) - distance(b));
      return this.spawnUnit(type, owner, spots[0][0] + 0.5, spots[0][1] + 0.5);
    }
    const spot = this.nearestFreeTile(building.x + building.w / 2, building.y + building.h + 0.5) ?? [building.x, building.y];
    return this.spawnUnit(type, owner, spot[0] + 0.5, spot[1] + 0.5);
  }

  /**
   * 무리 이동의 목적지 칸들: 목표에서 걸어서 이어진 빈 칸을 가까운 순서로 count개.
   * 목표 칸에서 퍼져 나가며(BFS) 모으므로 벽 너머 칸은 뽑히지 않는다.
   */
  destinationSlots(x, y, count) {
    let start = [Math.floor(x), Math.floor(y)];
    if (this.nav.isBlocked(start[0], start[1])) {
      start = this.nearestFreeTile(x, y);
      if (!start) return [];
    }
    const wanted = Math.min(count * 2 + 8, 400);
    const seen = new Set([start[1] * this.width + start[0]]);
    const found = [];
    const queue = [start];
    for (let head = 0; head < queue.length && found.length < wanted; head++) {
      const [tx, ty] = queue[head];
      found.push([tx, ty]);
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (this.nav.isBlocked(nx, ny)) continue;
        if (dx && dy && (this.nav.isBlocked(nx, ty) || this.nav.isBlocked(tx, ny))) continue;
        const i = ny * this.width + nx;
        if (seen.has(i)) continue;
        seen.add(i);
        queue.push([nx, ny]);
      }
    }
    const distance = ([tx, ty]) => Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
    return found.sort((a, b) => distance(a) - distance(b)).slice(0, count);
  }

/**
   * 등에 태운다. 유닛은 그대로 world.units에 남아 있고 자리만 등 위로 옮긴다.
   * (탄 유닛은 피해를 받지 않고 움직이지도 않지만, 원거리 유닛은 등 위에서 쏜다)
   */
  boardUnit(carrier, unit) {
    this.stopUnit(unit);
    unit.carrierId = carrier.id;
    unit.x = carrier.x;
    unit.y = carrier.y;
    unit.cooldown = 0;
    carrier.garrison.push(unit.id);
  }

  /** 등에 탄 유닛을 모두 내린다. 태운 쪽 둘레의 서로 다른 빈 칸에 놓는다. */
  unloadAll(carrier) {
    const ids = carrier.garrison.filter((id) => this.units.has(id));
    carrier.garrison = [];
    const spots = this.destinationSlots(carrier.x, carrier.y, ids.length + 1);
    ids.forEach((id, i) => {
      const unit = this.units.get(id);
      const spot = spots[i + 1] ?? spots[0] ?? [Math.floor(carrier.x), Math.floor(carrier.y)];
      unit.carrierId = null;
      unit.x = spot[0] + 0.5;
      unit.y = spot[1] + 0.5;
      unit.navVersion = -1;
    });
    return ids.length;
  }

  /** 등에 탄 유닛은 태운 쪽을 따라다닌다 */
  moveGarrisonWithCarrier(carrier) {
    for (const id of carrier.garrison) {
      const unit = this.units.get(id);
      if (!unit) continue;
      unit.x = carrier.x;
      unit.y = carrier.y;
    }
  }

  /** 사각형 안에 걸친 유닛을 가장 가까운 빈 칸으로 옮긴다 */
  ejectUnits(rect) {
    for (const unit of this.units.values()) {
      if (unit.carrierId) continue;
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

  teamOf(slot) {
    return this.players[slot]?.team ?? slot;
  }

  /** 서로 다른 팀이면 적이다. 같은 팀(나 자신 포함)은 공격하지 않고 오라 같은 이로운 효과를 나눈다 */
  areEnemies(slotA, slotB) {
    return this.teamOf(slotA) !== this.teamOf(slotB);
  }

  /** 그 팀이 지금 볼 수 있는가 (우리 팀 것은 늘 보인다) */
  isVisibleTo(team, entity) {
    if (this.teamOf(entity.owner) === team) return true;
    return entity.w !== undefined ? this.vision.isRectVisible(team, entity) : this.vision.isVisible(team, entity.x, entity.y);
  }

  /** 그 팀이 공격 대상으로 고를 수 있는가: 지금 보이는 것, 또는 한 번 본 건물 (건물은 움직이지 않는다) */
  canTarget(team, entity) {
    return this.isVisibleTo(team, entity) || (entity.w !== undefined && this.knownBuildings[team].has(entity.id));
  }

  /** id로 유닛이나 건물을 찾는다 (둘은 같은 id 공간을 쓴다) */
  entity(id) {
    return this.units.get(id) ?? this.buildings.get(id) ?? null;
  }

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
    for (const u of this.units.values()) {
      this.players[u.owner].pop += UNITS[u.type].pop;
      // 뿌리내린 아르카논은 전진 기지다: 인구 상한을 올려 준다
      if (u.rooted) this.players[u.owner].popCap += ABILITIES.root.popCap;
    }
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
