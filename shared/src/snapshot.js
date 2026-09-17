// 스냅샷 인코딩. 서버는 encode*로 배열을 만들고 클라이언트는 decode*로 푼다.
// 틱마다 바뀐 것만 보낸다 (아래 델타 절). 첫 입장·재접속 때만 전체 상태를 보낸다.
//
// 스냅샷 모양:
// { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own?, allies? }
// me·own·allies는 받는 플레이어의 것만 들어 있고, 바뀌지 않은 항목은 아예 오지 않는다.

import { TICK_MS } from './constants.js';
import { UNIT_TYPES } from './data/units.js';
import { BUILDING_TYPES } from './data/buildings.js';
import { ABILITY_IDS } from './data/abilities.js';
import { OATH_IDS } from './data/oaths.js';

/** 좌표를 1/16 타일 정수로 보낸다 */
export const POS_SCALE = 16;

const UNIT_INDEX = Object.fromEntries(UNIT_TYPES.map((type, i) => [type, i]));
const BUILDING_INDEX = Object.fromEntries(BUILDING_TYPES.map((type, i) => [type, i]));
const ABILITY_INDEX = Object.fromEntries(ABILITY_IDS.map((id, i) => [id, i]));
const CARRY_KINDS = [null, 'gold', 'wood'];

/** 유닛 상태 비트 (인코딩 9번 칸) */
export const UNIT_FLAG = Object.freeze({
  SHIELD_WALL: 1,
  STUNNED: 2,
  SLOWED: 4,
  ROOTED: 8,
  ROOTING: 16, // 뿌리내리는·뽑는 중
  CHANNELING: 32,
  AURA: 64, // 새벽의 오라를 받는 중
  CARRIED: 128, // 아르카논 등에 타고 있다
});

const unitFlags = (u) =>
  (u.shieldWall ? UNIT_FLAG.SHIELD_WALL : 0) |
  (u.stunned ? UNIT_FLAG.STUNNED : 0) |
  (u.slowed ? UNIT_FLAG.SLOWED : 0) |
  (u.rooted ? UNIT_FLAG.ROOTED : 0) |
  (u.rooting ? UNIT_FLAG.ROOTING : 0) |
  (u.channeling ? UNIT_FLAG.CHANNELING : 0) |
  (u.buffed ? UNIT_FLAG.AURA : 0) |
  (u.carried ? UNIT_FLAG.CARRIED : 0);

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
    unitFlags(u),
    u.extra ?? 0, // 유닛 종류별 추가 값: 아르카논=탑승 인원, 에테리아=영창 남은 틱
  ];
}

/** 지난 인코딩이 지금 유닛과 같은가 (새 배열을 만들지 않고 비교만 한다. 종류·주인은 바뀌지 않는다) */
export function unitMatchesEncoding(u, a) {
  return (
    a[3] === Math.round(u.x * POS_SCALE) &&
    a[4] === Math.round(u.y * POS_SCALE) &&
    a[5] === Math.ceil(u.hp) &&
    a[6] === u.state &&
    a[7] === (u.carry ? CARRY_KINDS.indexOf(u.carry.kind) : 0) &&
    a[8] === (u.carry ? u.carry.amount : 0) &&
    a[9] === unitFlags(u) &&
    a[10] === (u.extra ?? 0)
  );
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
    extra: a[10] ?? 0,
    ...decodeFlags(a[9]),
  };
}

/** 상태 비트를 이름 붙은 값으로 (클라이언트 UI·렌더링용) */
export function decodeFlags(flags) {
  return {
    flags,
    shieldWall: Boolean(flags & UNIT_FLAG.SHIELD_WALL),
    stunned: Boolean(flags & UNIT_FLAG.STUNNED),
    slowed: Boolean(flags & UNIT_FLAG.SLOWED),
    rooted: Boolean(flags & UNIT_FLAG.ROOTED),
    rooting: Boolean(flags & UNIT_FLAG.ROOTING),
    channeling: Boolean(flags & UNIT_FLAG.CHANNELING),
    buffed: Boolean(flags & UNIT_FLAG.AURA),
    carried: Boolean(flags & UNIT_FLAG.CARRIED),
  };
}

/** 모두에게 보이는 플레이어 정보: [slot, 시대, 왕관 몰락까지 남은 초(없으면 -1), 패배 0|1, 맹세(없으면 -1), 팀] */
export function encodePublicPlayer(p, tick) {
  const collapseSeconds = p.collapseAt == null ? -1 : Math.max(0, Math.ceil(((p.collapseAt - tick) * TICK_MS) / 1000));
  return [p.slot, p.age, collapseSeconds, p.defeated ? 1 : 0, p.oath ? OATH_IDS.indexOf(p.oath) : -1, p.team ?? p.slot];
}

export function decodePublicPlayer(a) {
  return {
    slot: a[0],
    age: a[1],
    collapseSeconds: a[2] < 0 ? null : a[2],
    defeated: Boolean(a[3]),
    oath: a[4] >= 0 ? OATH_IDS[a[4]] : null,
    team: a[5] ?? a[0],
  };
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

/** 지난 인코딩이 지금 건물과 같은가 (자리·종류·주인은 바뀌지 않는다) */
export function buildingMatchesEncoding(b, a) {
  return a[5] === Math.ceil(b.hp) && a[6] === Math.floor(b.progress * 1000) && a[7] === ((b.complete ? 1 : 0) | (b.started ? 2 : 0));
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
 * 나만 보는 정보: 생산 대기열, 집결지, 능력 재사용 대기.
 * {
 *   q: [[id, [unitTypeIndex...], 맨 앞 진행도 0–1000, 인구 부족으로 멈춤 0|1]],  // 건물과 뿌리내린 아르카논
 *   r: [[buildingId, x16, y16]],
 *   a: [[unitId, abilityIndex, 다시 쓸 수 있는 틱]]   // 남은 시간이 아니라 '틱'이라 매 틱 바뀌지 않는다
 * }
 */
export function encodeOwn(buildings, units, slot) {
  const q = [];
  const r = [];
  const a = [];
  const pushQueue = (entity) => {
    const head = entity.queue[0];
    q.push([
      entity.id,
      entity.queue.map((item) => UNIT_INDEX[item.type]),
      Math.floor(head.progress * 1000),
      head.blocked ? 1 : 0,
    ]);
  };

  for (const b of buildings) {
    if (b.owner !== slot) continue;
    if (b.queue?.length) pushQueue(b);
    if (b.rally) r.push([b.id, Math.round(b.rally.x * POS_SCALE), Math.round(b.rally.y * POS_SCALE)]);
  }
  for (const u of units) {
    if (u.owner !== slot) continue;
    if (u.queue?.length) pushQueue(u);
    for (const ability in u.cooldowns ?? {}) a.push([u.id, ABILITY_INDEX[ability], u.cooldowns[ability]]);
  }
  return { q, r, a };
}

export function decodeOwn(own) {
  const queues = new Map();
  const rallies = new Map();
  const cooldowns = new Map(); // unitId → { ability: 다시 쓸 수 있는 틱 }
  for (const [id, types, progress, blocked] of own?.q ?? []) {
    queues.set(id, { types: types.map((i) => UNIT_TYPES[i]), progress: progress / 1000, blocked: Boolean(blocked) });
  }
  for (const [id, x, y] of own?.r ?? []) rallies.set(id, { x: x / POS_SCALE, y: y / POS_SCALE });
  for (const [id, ability, readyTick] of own?.a ?? []) {
    if (!cooldowns.has(id)) cooldowns.set(id, {});
    cooldowns.get(id)[ABILITY_IDS[ability]] = readyTick;
  }
  return { queues, rallies, cooldowns };
}

/** 팀원의 자원 (팀전): [[slot, 금, 목재, 마나]] — 받는 사람 자신은 뺀다. 1대1이면 빈 배열 */
export function encodeAllies(players, slot) {
  const team = players[slot].team ?? slot;
  const allies = [];
  for (const p of players) {
    if (!p || p.slot === slot || (p.team ?? p.slot) !== team) continue;
    allies.push([p.slot, Math.floor(p.gold), Math.floor(p.wood), Math.floor(p.mana)]);
  }
  return allies;
}

export function decodeAllies(list) {
  return new Map(list.map(([slot, gold, wood, mana]) => [slot, { gold, wood, mana }]));
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

// 위치는 지난번에 보낸 위치에서 움직인 만큼(MOVE, 1/16타일)을 보낸다. 한 틱 이동은 몇 칸이라
// 숫자가 짧고 반복이 많아 절대 좌표보다 원본은 약 25%, 압축 뒤에는 훨씬 더 준다.
// POS(절대 좌표)는 예전(버전 1) 리플레이를 읽으려고 남겨 둔다.
export const UNIT_DELTA = Object.freeze({ POS: 1, HP: 2, STATE: 4, CARRY: 8, FLAGS: 16, EXTRA: 32, MOVE: 64 });
export const BUILDING_DELTA = Object.freeze({ HP: 1, PROGRESS: 2, FLAGS: 4 });

/** 바뀐 필드만 담은 [id, 마스크, ...값]. 바뀐 게 없으면 null */
export function diffUnit(previous, current) {
  let mask = 0;
  const values = [];
  if (previous[3] !== current[3] || previous[4] !== current[4]) {
    mask |= UNIT_DELTA.MOVE;
    values.push(current[3] - previous[3], current[4] - previous[4]);
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
  if (previous[10] !== current[10]) {
    mask |= UNIT_DELTA.EXTRA;
    values.push(current[10]);
  }
  return mask ? [current[0], mask, ...values] : null;
}

/** 델타를 클라이언트 유닛 객체에 적용한다. 위치가 바뀌었으면 true */
export function applyUnitDelta(unit, delta) {
  const mask = delta[1];
  let i = 2;
  const moved = Boolean(mask & (UNIT_DELTA.POS | UNIT_DELTA.MOVE));
  if (mask & UNIT_DELTA.POS) {
    unit.x = delta[i++] / POS_SCALE;
    unit.y = delta[i++] / POS_SCALE;
  } else if (mask & UNIT_DELTA.MOVE) {
    // 좌표는 늘 1/16의 배수라 소수 오차 없이 정수로 되돌려 더할 수 있다
    unit.x = (Math.round(unit.x * POS_SCALE) + delta[i++]) / POS_SCALE;
    unit.y = (Math.round(unit.y * POS_SCALE) + delta[i++]) / POS_SCALE;
  }
  if (mask & UNIT_DELTA.HP) unit.hp = delta[i++];
  if (mask & UNIT_DELTA.STATE) unit.state = delta[i++];
  if (mask & UNIT_DELTA.CARRY) {
    unit.carryKind = CARRY_KINDS[delta[i++]];
    unit.carryAmount = delta[i++];
  }
  if (mask & UNIT_DELTA.FLAGS) Object.assign(unit, decodeFlags(delta[i++]));
  if (mask & UNIT_DELTA.EXTRA) unit.extra = delta[i++];
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
