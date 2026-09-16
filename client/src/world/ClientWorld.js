import { TICK_MS } from '@rune/shared/constants.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';
import { ABILITIES, ABILITY_IDS } from '@rune/shared/data/abilities.js';
import {
  applyBuildingDelta,
  applyUnitDelta,
  decodeBuilding,
  decodeOwn,
  decodePlayer,
  decodePublicPlayer,
  decodeUnit,
  POS_SCALE,
} from '@rune/shared/snapshot.js';

/** 유닛은 그리는 위치, 건물은 풋프린트 중심 (타일 좌표) */
const centerOf = (entity) =>
  entity.size ? { x: entity.x + entity.size / 2, y: entity.y + entity.size / 2 } : { x: entity.drawX, y: entity.drawY };

/**
 * 스냅샷 보간. 화면은 서버보다 INTERP_DELAY 틱(=100ms) 뒤를 보여 준다.
 * 그만큼 늦게 보는 대신 다음 스냅샷이 이미 도착해 있어서, 두 위치 사이를 이어 그릴 수 있다.
 * (지난 위치로 따라가는 방식과 달리 속도가 일정해 보이고, 한 틱을 놓쳐도 튀지 않는다)
 */
const INTERP_DELAY = 2;
const MAX_SAMPLES = 6;
const MAX_DRIFT = 8; // 이만큼 어긋나면 부드럽게 맞추지 않고 그냥 건너뛴다

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
    this.publicPlayers = new Map(); // slot → { age, collapseSeconds, defeated }
    /** 전투 효과 (투사체·타격·쓰러짐). 렌더러가 시간이 지난 것을 지운다 */
    this.effects = [];
    this.tick = -1;
    /** 마지막으로 받은 서버 틱과, 지금 그리고 있는 시점(소수 틱) */
    this.serverTick = -1;
    this.renderTick = -1;
    this.queues = new Map(); // 건물·뿌리내린 아르카논 → 생산 대기열
    this.rallies = new Map(); // buildingId → 집결지
    this.cooldowns = new Map(); // unitId → { 능력: 다시 쓸 수 있는 틱 }
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

  /**
   * 델타 스냅샷을 적용한다. { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own? }
   * 안 바뀐 항목은 아예 오지 않으므로 지난 값을 그대로 쓴다.
   * full이면 지난 상태를 버리고 통째로 다시 맞춘다 (첫 입장·재접속).
   */
  applySnapshot(snap) {
    if (snap.full) this.reset();
    this.tick = snap.t;
    this.serverTick = snap.t;
    if (snap.me) this.me = decodePlayer(snap.me);
    for (const raw of snap.players ?? []) {
      const info = decodePublicPlayer(raw);
      this.ages.set(info.slot, info.age);
      this.publicPlayers.set(info.slot, info);
    }
    const removed = new Map(); // 이번 스냅샷에서 사라진 유닛·건물 (쓰러짐 효과 위치용)

    for (const raw of snap.addU ?? []) {
      const data = decodeUnit(raw);
      const unit = { ...data, drawX: data.x, drawY: data.y, facing: 1, samples: [] };
      this.units.set(data.id, unit);
      this.pushSample(unit, snap.t);
    }
    for (const delta of snap.updU ?? []) {
      const unit = this.units.get(delta[0]);
      if (!unit) continue;
      if (applyUnitDelta(unit, delta)) this.pushSample(unit, snap.t);
    }

    for (const raw of snap.addB ?? []) {
      const data = decodeBuilding(raw);
      this.buildings.set(data.id, { ...data, size: BUILDINGS[data.type].size });
      this.occupancyDirty = true;
    }
    for (const delta of snap.updB ?? []) {
      const building = this.buildings.get(delta[0]);
      if (building) applyBuildingDelta(building, delta);
    }

    for (const id of snap.del ?? []) {
      const unit = this.units.get(id);
      if (unit) {
        removed.set(id, unit);
        this.units.delete(id);
        continue;
      }
      const building = this.buildings.get(id);
      if (building) {
        removed.set(id, building);
        this.buildings.delete(id);
        this.occupancyDirty = true;
      }
    }

    for (const [id, amount] of snap.mines ?? []) {
      if (amount > 0) this.mineAmounts.set(id, amount);
      else if (this.mineAmounts.delete(id)) this.occupancyDirty = true;
    }

    // 내 건물·유닛의 생산 대기열, 집결지, 능력 대기. 안 바뀌었으면 own이 오지 않으니 지난 값을 그대로 쓴다
    if (snap.own) {
      const { queues, rallies, cooldowns } = decodeOwn(snap.own);
      this.queues = queues;
      this.rallies = rallies;
      this.cooldowns = cooldowns;
    }
    if (snap.own || snap.addB?.length || snap.addU?.length) {
      for (const building of this.buildings.values()) {
        building.production = this.queues.get(building.id) ?? null;
        building.rally = this.rallies.get(building.id) ?? null;
      }
      for (const unit of this.units.values()) unit.production = this.queues.get(unit.id) ?? null;
    }

    for (const event of snap.ev ?? []) {
      if (event[0] === GAME_EVENT.TREE_FELLED) {
        this.tiles[event[1]] = TERRAIN.GRASS;
        this.onTreeFelled?.(event[1]);
      }
      this.addCombatEffect(event, removed);
      this.onEvent?.(event);
    }
  }

  /** 전체 스냅샷을 받기 전에 지난 상태를 비운다 (재접속) */
  reset() {
    this.units.clear();
    this.buildings.clear();
    this.mineAmounts.clear();
    this.queues.clear();
    this.rallies.clear();
    this.cooldowns.clear();
    this.effects.length = 0;
    this.renderTick = -1;
    this.occupancyDirty = true;
  }

  /** 보간에 쓸 위치 표본. 움직인 틱에만 쌓인다 */
  pushSample(unit, tick) {
    unit.samples.push({ t: tick, x: unit.x, y: unit.y });
    if (unit.samples.length > MAX_SAMPLES) unit.samples.shift();
  }

  addCombatEffect(event, removed) {
    const now = performance.now();
    const find = (id) => this.units.get(id) ?? this.buildings.get(id) ?? removed.get(id);

    if (event[0] === GAME_EVENT.ATTACK) {
      const attacker = find(event[1]);
      const target = find(event[2]);
      if (!attacker || !target) return;
      const attack = (UNITS[attacker.type] ?? BUILDINGS[attacker.type]).attack;
      const to = centerOf(target);
      if (attack.range <= 1.5) {
        this.effects.push({ kind: 'slash', x: to.x, y: to.y, start: now, duration: 220 });
        return;
      }
      const from = centerOf(attacker);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      this.effects.push({
        kind: attack.type === 'magic' ? 'bolt' : 'arrow',
        from,
        to,
        splash: attack.splash ?? 0,
        start: now,
        duration: 120 + distance * 35,
      });
    } else if (event[0] === GAME_EVENT.UNIT_DIED) {
      const unit = removed.get(event[1]);
      if (unit) this.effects.push({ kind: 'death', x: unit.drawX, y: unit.drawY, start: now, duration: 700 });
    } else if (event[0] === GAME_EVENT.ABILITY) {
      this.addAbilityEffect(event, now);
    } else if (event[0] === GAME_EVENT.BUILDING_DESTROYED) {
      const building = removed.get(event[1]);
      if (building) {
        const { x, y } = centerOf(building);
        this.effects.push({ kind: 'rubble', x, y, size: building.size, start: now, duration: 1600 });
      }
    }
  }

  /** 능력 효과: 돌진 자국, 성좌 붕괴 영창·폭발, 시간의 결계 */
  addAbilityEffect(event, now) {
    const [, unitId, abilityIndex, x16, y16, phase] = event;
    const ability = ABILITY_IDS[abilityIndex];
    const x = x16 / POS_SCALE;
    const y = y16 / POS_SCALE;
    const unit = this.units.get(unitId);

    if (ability === 'dawnCharge' && unit) {
      this.effects.push({ kind: 'charge', from: { x: unit.drawX, y: unit.drawY }, to: { x, y }, start: now, duration: 450 });
    } else if (ability === 'starfall') {
      this.effects = this.effects.filter((e) => e.kind !== 'starfallCast'); // 영창은 하나뿐
      if (phase === 0) {
        this.effects.push({ kind: 'starfallCast', x, y, radius: ABILITIES.starfall.radius, start: now, duration: ABILITIES.starfall.channel * 1000 });
      } else if (phase === 1) {
        this.effects.push({ kind: 'starfallHit', x, y, radius: ABILITIES.starfall.radius, start: now, duration: 800 });
      }
    } else if (ability === 'timeWard') {
      this.effects.push({ kind: 'ward', x, y, radius: ABILITIES.timeWard.radius, start: now, duration: ABILITIES.timeWard.duration * 1000 });
    } else if (ability === 'root' && phase === 1 && unit) {
      this.effects.push({ kind: 'rootBurst', x: unit.drawX, y: unit.drawY, start: now, duration: 600 });
    }
  }

  /**
   * 그리는 시점(renderTick)을 흘려보내고, 유닛마다 그 시점의 위치를 표본 사이에서 찾는다.
   * 서버 틱보다 늦었으면 조금 빠르게, 너무 앞섰으면 조금 느리게 흘러서 지연을 일정하게 지킨다.
   */
  updateDrawPositions(dt) {
    if (this.serverTick < 0) return;
    const target = this.serverTick - INTERP_DELAY;
    if (this.renderTick < 0 || Math.abs(target - this.renderTick) > MAX_DRIFT) {
      this.renderTick = target; // 처음이거나 너무 벌어졌다 (재접속·긴 끊김)
    } else {
      const drift = Math.max(-0.2, Math.min(0.2, (target - this.renderTick) * 0.1));
      this.renderTick += ((dt * 1000) / TICK_MS) * (1 + drift);
    }

    const now = this.renderTick;
    for (const unit of this.units.values()) {
      const samples = unit.samples;
      while (samples.length > 2 && samples[1].t <= now) samples.shift();

      let x = unit.x;
      let y = unit.y;
      if (samples.length === 1 || (samples.length > 1 && now <= samples[0].t)) {
        x = samples[0].x;
        y = samples[0].y;
      } else if (samples.length > 1) {
        const [a, b] = samples;
        const k = Math.max(0, Math.min(1, (now - a.t) / (b.t - a.t)));
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
      }

      const dx = x - unit.drawX;
      if (Math.abs(dx) > 0.004) unit.facing = dx > 0 ? 1 : -1;
      unit.drawX = x;
      unit.drawY = y;
    }
  }

  // ---------- 조회 ----------

  isMine(entity) {
    return entity.owner === this.mySlot;
  }

  /** 내가 맺은 맹세 (없으면 null) */
  myOath() {
    return this.publicPlayers.get(this.mySlot)?.oath ?? null;
  }

  oathOf(slot) {
    return this.publicPlayers.get(slot)?.oath ?? null;
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
      if (unit.carried) continue; // 등에 탄 유닛은 고를 수 없다
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
      (u) => this.isMine(u) && !u.carried && u.drawX >= minX && u.drawX <= maxX && u.drawY >= minY && u.drawY <= maxY,
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
