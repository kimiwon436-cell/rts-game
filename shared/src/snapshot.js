// 스냅샷 인코딩. 서버는 encode*로 배열을 만들고 클라이언트는 decode*로 푼다.
// 3-2는 매 틱 전체 상태를 보낸다. 3-5에서 바뀐 부분만 보내는 델타로 바꾼다.
//
// 스냅샷 모양:
// { t, me, own, players: [[slot, age]], units: [...], buildings: [...], mines: [[mineId, amount]], ev: [[code, ...]] }
// me와 own은 받는 플레이어의 것만 들어 있다.

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
