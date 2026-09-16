// 스냅샷 인코딩. 서버는 encode*로 배열을 만들고 클라이언트는 decode*로 푼다.
// 틱마다 바뀐 것만 보낸다 (아래 델타 절). 첫 입장·재접속 때만 전체 상태를 보낸다.
//
// 스냅샷 모양:
// { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own? }
// me와 own은 받는 플레이어의 것만 들어 있고, 바뀌지 않은 항목은 아예 오지 않는다.

import { TICK_MS } from './constants.js';
import { UNIT_TYPES } from './data/units.js';
import { BUILDING_TYPES } from './data/buildings.js';

/** 좌표를 1/16 타일 정수로 보낸다 */
export const POS_SCALE = 16;

const UNIT_INDEX = Object.fromEntries(UNIT_TYPES.map((type, i) => [type, i]));
const BUILDING_INDEX = Object.fromEntries(BUILDING_TYPES.map((type, i) => [type, i]));
const CARRY_KINDS = [null, 'gold', 'wood'];

export function encodeUnit(u) {
  return [
    u.id,
    UNIT_INDEX[u.type],
    u.owner,
    Math.round(u.x * POS_SCALE),
    Math.round(u.y * POS_SCALE),
    Math.ceil(u.hp),
    u.state,
    u.carry ? CARRY_KINDS.indexOf(u.carry.kind) : 0,
    u.carry ? u.carry.amount : 0,
    u.shieldWall ? 1 : 0, // 상태 비트: 1 = 방패벽
  ];
}

export function decodeUnit(a) {
  return {
    id: a[0],
    type: UNIT_TYPES[a[1]],
    owner: a[2],
    x: a[3] / POS_SCALE,
    y: a[4] / POS_SCALE,
    hp: a[5],
    state: a[6],
    carryKind: CARRY_KINDS[a[7]],
    carryAmount: a[8],
    shieldWall: Boolean(a[9] & 1),
  };
}

/** 모두에게 보이는 플레이어 정보: [slot, 시대, 왕관 몰락까지 남은 초(없으면 -1), 패배 0|1] */
export function encodePublicPlayer(p, tick) {
  const collapseSeconds = p.collapseAt == null ? -1 : Math.max(0, Math.ceil(((p.collapseAt - tick) * TICK_MS) / 1000));
  return [p.slot, p.age, collapseSeconds, p.defeated ? 1 : 0];
}

export function decodePublicPlayer(a) {
  return { slot: a[0], age: a[1], collapseSeconds: a[2] < 0 ? null : a[2], defeated: Boolean(a[3]) };
}

export function encodeBuilding(b) {
  return [
    b.id,
    BUILDING_INDEX[b.type],
    b.owner,
    b.x,
    b.y,
    Math.ceil(b.hp),
    Math.floor(b.progress * 1000),
    (b.complete ? 1 : 0) | (b.started ? 2 : 0),
  ];
}

export function decodeBuilding(a) {
  return {
    id: a[0],
    type: BUILDING_TYPES[a[1]],
    owner: a[2],
    x: a[3],
    y: a[4],
    hp: a[5],
    progress: a[6] / 1000,
    complete: Boolean(a[7] & 1),
    started: Boolean(a[7] & 2),
  };
}

export function encodePlayer(p) {
  return [
    Math.floor(p.gold),
    Math.floor(p.wood),
    Math.floor(p.mana),
    p.pop,
    p.popCap,
    p.age,
    p.ageTarget,
    Math.floor(p.ageProgress * 1000),
    Math.round(p.market.wood),
    Math.round(p.market.mana),
  ];
}

/**
 * 내 건물만의 정보: 생산 대기열과 집결지.
 * { q: [[buildingId, [unitTypeIndex...], 맨 앞 진행도 0–1000, 인구 부족으로 멈춤 0|1]], r: [[buildingId, x16, y16]] }
 */
export function encodeOwn(buildings, slot) {
  const q = [];
  const r = [];
  for (const b of buildings) {
    if (b.owner !== slot) continue;
    if (b.queue?.length) {
      const head = b.queue[0];
      q.push([b.id, b.queue.map((item) => UNIT_INDEX[item.type]), Math.floor(head.progress * 1000), head.blocked ? 1 : 0]);
    }
    if (b.rally) r.push([b.id, Math.round(b.rally.x * POS_SCALE), Math.round(b.rally.y * POS_SCALE)]);
  }
  return { q, r };
}

export function decodeOwn(own) {
  const queues = new Map();
  const rallies = new Map();
  for (const [id, types, progress, blocked] of own?.q ?? []) {
    queues.set(id, { types: types.map((i) => UNIT_TYPES[i]), progress: progress / 1000, blocked: Boolean(blocked) });
  }
  for (const [id, x, y] of own?.r ?? []) rallies.set(id, { x: x / POS_SCALE, y: y / POS_SCALE });
  return { queues, rallies };
}

export function decodePlayer(a) {
  return {
    gold: a[0],
    wood: a[1],
    mana: a[2],
    pop: a[3],
    popCap: a[4],
    age: a[5],
    ageTarget: a[6],
    ageProgress: a[7] / 1000,
    market: { wood: a[8], mana: a[9] },
  };
}

// ---------- 델타 (3-5) ----------
// 틱마다 바뀐 필드만 보낸다. 서버는 지난번에 보낸 인코딩과 비교해 마스크를 만들고,
// 클라이언트는 마스크를 보고 그 필드만 덮어쓴다.

export const UNIT_DELTA = Object.freeze({ POS: 1, HP: 2, STATE: 4, CARRY: 8, FLAGS: 16 });
export const BUILDING_DELTA = Object.freeze({ HP: 1, PROGRESS: 2, FLAGS: 4 });

/** 바뀐 필드만 담은 [id, 마스크, ...값]. 바뀐 게 없으면 null */
export function diffUnit(previous, current) {
  let mask = 0;
  const values = [];
  if (previous[3] !== current[3] || previous[4] !== current[4]) {
    mask |= UNIT_DELTA.POS;
    values.push(current[3], current[4]);
  }
  if (previous[5] !== current[5]) {
    mask |= UNIT_DELTA.HP;
    values.push(current[5]);
  }
  if (previous[6] !== current[6]) {
    mask |= UNIT_DELTA.STATE;
    values.push(current[6]);
  }
  if (previous[7] !== current[7] || previous[8] !== current[8]) {
    mask |= UNIT_DELTA.CARRY;
    values.push(current[7], current[8]);
  }
  if (previous[9] !== current[9]) {
    mask |= UNIT_DELTA.FLAGS;
    values.push(current[9]);
  }
  return mask ? [current[0], mask, ...values] : null;
}

/** 델타를 클라이언트 유닛 객체에 적용한다. 위치가 바뀌었으면 true */
export function applyUnitDelta(unit, delta) {
  const mask = delta[1];
  let i = 2;
  const moved = Boolean(mask & UNIT_DELTA.POS);
  if (moved) {
    unit.x = delta[i++] / POS_SCALE;
    unit.y = delta[i++] / POS_SCALE;
  }
  if (mask & UNIT_DELTA.HP) unit.hp = delta[i++];
  if (mask & UNIT_DELTA.STATE) unit.state = delta[i++];
  if (mask & UNIT_DELTA.CARRY) {
    unit.carryKind = CARRY_KINDS[delta[i++]];
    unit.carryAmount = delta[i++];
  }
  if (mask & UNIT_DELTA.FLAGS) unit.shieldWall = Boolean(delta[i++] & 1);
  return moved;
}

export function diffBuilding(previous, current) {
  let mask = 0;
  const values = [];
  if (previous[5] !== current[5]) {
    mask |= BUILDING_DELTA.HP;
    values.push(current[5]);
  }
  if (previous[6] !== current[6]) {
    mask |= BUILDING_DELTA.PROGRESS;
    values.push(current[6]);
  }
  if (previous[7] !== current[7]) {
    mask |= BUILDING_DELTA.FLAGS;
    values.push(current[7]);
  }
  return mask ? [current[0], mask, ...values] : null;
}

export function applyBuildingDelta(building, delta) {
  const mask = delta[1];
  let i = 2;
  if (mask & BUILDING_DELTA.HP) building.hp = delta[i++];
  if (mask & BUILDING_DELTA.PROGRESS) building.progress = delta[i++] / 1000;
  if (mask & BUILDING_DELTA.FLAGS) {
    const flags = delta[i++];
    building.complete = Boolean(flags & 1);
    building.started = Boolean(flags & 2);
  }
}
