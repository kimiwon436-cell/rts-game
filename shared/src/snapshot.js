// 스냅샷 인코딩. 서버는 encode*로 배열을 만들고 클라이언트는 decode*로 푼다.
// 3-2는 매 틱 전체 상태를 보낸다. 3-5에서 바뀐 부분만 보내는 델타로 바꾼다.
//
// 스냅샷 모양:
// { t, me, players: [[slot, age]], units: [...], buildings: [...], mines: [[mineId, amount]], ev: [[code, ...]] }

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
