import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNITS } from '../src/data/units.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { attackReach, computeDamage, MELEE_REACH } from '../src/rules/combat.js';

const vsUnit = (type, extra = {}) => ({ def: UNITS[type], ...extra });
const vsBuilding = (type) => ({ building: true, type });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('창병은 기병에게 3배: 기사에게 9 × 중갑 0.8 × 3', () => {
  near(computeDamage(UNITS.pikeman, vsUnit('knight')), 21.6);
  near(computeDamage(UNITS.pikeman, vsUnit('scout_rider')), 27);
  near(computeDamage(UNITS.pikeman, vsUnit('longbowman')), 9);
});

test('장궁병의 관통은 경갑에 1.25배, 중갑에 0.6배', () => {
  near(computeDamage(UNITS.longbowman, vsUnit('pikeman')), 15);
  near(computeDamage(UNITS.longbowman, vsUnit('knight')), 7.2);
});

test('전투 마법사의 마법은 중갑에 1.5배', () => {
  near(computeDamage(UNITS.battlemage, vsUnit('royal_guard')), 30);
  near(computeDamage(UNITS.battlemage, vsUnit('pikeman')), 20);
});

test('방패벽을 켠 근위병은 관통 피해만 60% 덜 받는다', () => {
  near(computeDamage(UNITS.longbowman, vsUnit('royal_guard', { shieldWall: true })), 12 * 0.6 * 0.4);
  near(computeDamage(UNITS.pikeman, vsUnit('royal_guard', { shieldWall: true })), 9 * 0.8);
});

test('척후 기병은 오벨리스크·농가에 3배, 다른 건물엔 기본 배율', () => {
  near(computeDamage(UNITS.scout_rider, vsBuilding('obelisk')), 8 * 0.4 * 3);
  near(computeDamage(UNITS.scout_rider, vsBuilding('barracks')), 8 * 0.4);
});

test('감시탑 화살은 관통 14, 피해는 최소 1', () => {
  near(computeDamage(BUILDINGS.watchtower, vsUnit('longbowman')), 17.5);
  assert.equal(computeDamage({ attack: { damage: 1, type: 'pierce', range: 6 } }, vsBuilding('keep')), 1);
});

test('근접은 몸 사이 0.4타일, 원거리는 사거리만큼 닿는다', () => {
  assert.equal(attackReach(UNITS.knight.attack), MELEE_REACH);
  assert.equal(attackReach(UNITS.longbowman.attack), 6);
});
