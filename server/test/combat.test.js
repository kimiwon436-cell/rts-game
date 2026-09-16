import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, GAME_EVENT, REJECT, UNIT_STATE } from '@rune/shared/protocol.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];
const newWorld = () => new World(loadMap('duel01'), PLAYERS);

let seq = 0;
function command(world, slot, cmd) {
  const { rejects } = stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]);
  return rejects[0]?.reason ?? null;
}

function runSeconds(world, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) stepWorld(world);
}

/** 이 틱의 이벤트에 attacker의 공격이 있을 때까지 돌린다 */
function runUntilAttack(world, attackerId, seconds = 5) {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
    const { events } = stepWorld(world);
    if (events.some(([code, id]) => code === GAME_EVENT.ATTACK && id === attackerId)) return;
  }
  throw new Error(`${seconds}초 안에 ${attackerId}가 공격하지 않았다`);
}

/** 본진에서 떨어진 탁 트인 곳: 가로 length칸이 위아래 한 칸씩 여유를 두고 모두 비어 있는 줄의 왼쪽 끝 */
function openRow(world, length) {
  for (let y = 60; y < 76; y++) {
    for (let x = 22; x < 62 - length; x++) {
      let clear = true;
      for (let dx = 0; dx < length && clear; dx++) {
        for (let dy = -1; dy <= 1 && clear; dy++) {
          if (world.nav.isBlocked(x + dx, y + dy) || world.occupied[(y + dy) * world.width + x + dx]) clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('빈 줄을 찾지 못했다');
}

const spawnInRow = (world, row, type, owner, dx) => world.spawnUnit(type, owner, row.x + dx + 0.5, row.y + 0.5);

test('창병 2기는 기사 1기를 이긴다 (기병에게 3배)', () => {
  const world = newWorld();
  const row = openRow(world, 10);
  const pikemen = [spawnInRow(world, row, 'pikeman', 0, 0), spawnInRow(world, row, 'pikeman', 0, 1)];
  const knight = spawnInRow(world, row, 'knight', 1, 4);

  runSeconds(world, 30);
  assert.ok(!world.units.has(knight.id), `기사가 살아남았다 (체력 ${knight.hp})`);
  assert.ok(pikemen.some((p) => world.units.has(p.id)), '창병이 모두 쓰러졌다');
});

test('기사 1기는 장궁병 2기를 이긴다', () => {
  const world = newWorld();
  const row = openRow(world, 12);
  const knight = spawnInRow(world, row, 'knight', 0, 0);
  const bows = [spawnInRow(world, row, 'longbowman', 1, 7), spawnInRow(world, row, 'longbowman', 1, 8)];

  runSeconds(world, 40);
  assert.ok(world.units.has(knight.id), '기사가 쓰러졌다');
  assert.ok(bows.every((b) => !world.units.has(b.id)), '장궁병이 살아남았다');
});

test('장궁병 2기는 창병 1기를 이긴다', () => {
  const world = newWorld();
  const row = openRow(world, 10);
  const pikeman = spawnInRow(world, row, 'pikeman', 0, 0);
  const bows = [spawnInRow(world, row, 'longbowman', 1, 6), spawnInRow(world, row, 'longbowman', 1, 7)];

  runSeconds(world, 30);
  assert.ok(!world.units.has(pikeman.id), '창병이 살아남았다');
  assert.ok(bows.some((b) => world.units.has(b.id)), '장궁병이 모두 쓰러졌다');
});

test('공격 명령을 받은 장궁병은 사거리 6까지만 다가가서 쏜다', () => {
  const world = newWorld();
  const row = openRow(world, 14);
  const bow = spawnInRow(world, row, 'longbowman', 0, 0);
  const peasant = spawnInRow(world, row, 'peasant', 1, 11);

  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [bow.id], targetId: peasant.id }), null);
  runUntilAttack(world, bow.id);
  const distance = Math.hypot(bow.x - peasant.x, bow.y - peasant.y);
  assert.ok(distance > 6 && distance <= 6.7, `쏘기 시작한 거리: ${distance.toFixed(2)}`);
});

test('전투 마법사의 공격은 1.2타일 안에 뭉친 적 여러 기에 들어간다', () => {
  const world = newWorld();
  const row = openRow(world, 10);
  const pikemen = [0, 0.6, 1.2].map((offset) => world.spawnUnit('pikeman', 1, row.x + 5.5 + offset, row.y + 0.5));
  const mage = spawnInRow(world, row, 'battlemage', 0, 1);

  runUntilAttack(world, mage.id);
  const hurt = pikemen.filter((p) => p.hp < 110).length;
  assert.ok(hurt >= 2, `맞은 창병: ${hurt}기`);
});

test('방패벽을 켠 근위병은 절반 속도로 걷고, 화살 피해를 60% 덜 받는다', () => {
  const world = newWorld();
  const row = openRow(world, 14);
  const guard = spawnInRow(world, row, 'royal_guard', 0, 0);

  assert.equal(command(world, 0, { type: CMD.TOGGLE_ABILITY, unitIds: [guard.id], ability: 'shieldWall' }), null);
  assert.equal(guard.shieldWall, true);
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [guard.id], x: row.x + 12.5, y: row.y + 0.5 }), null);
  const startX = guard.x;
  runSeconds(world, 1);
  const moved = guard.x - startX;
  assert.ok(moved > 0.5 && moved <= 2.1 * 0.5 * 1.1, `1초 동안 ${moved.toFixed(2)}타일 이동`);

  const bow = world.spawnUnit('longbowman', 1, guard.x + 5, row.y + 0.5);
  const before = guard.hp;
  runUntilAttack(world, bow.id);
  assert.ok(Math.abs(before - guard.hp - 12 * 0.6 * 0.4) < 1e-9, `받은 피해: ${before - guard.hp}`);
});

test('감시탑은 사거리 안에 들어온 적을 쏜다', () => {
  const world = newWorld();
  const row = openRow(world, 12);
  let tower = null;
  for (let dx = 0; dx < 10 && !tower; dx++) {
    const spot = { x: row.x + dx, y: row.y - 1 };
    const ok = checkPlacement({
      type: 'watchtower', ...spot, map: world.map, tiles: world.tiles, occupied: world.occupied, isWellTaken: () => false,
    });
    if (ok === PLACE.OK) tower = world.spawnBuilding('watchtower', 0, spot.x, spot.y, { complete: true });
  }
  assert.ok(tower, '감시탑 자리를 찾지 못했다');
  const [ex, ey] = world.nearestFreeTile(tower.x + 6.5, tower.y + 1);
  const peasant = world.spawnUnit('peasant', 1, ex + 0.5, ey + 0.5);

  runUntilAttack(world, tower.id);
  assert.equal(peasant.hp, 60 - 14 * 1.25);
});

test('공격 이동: 가는 길의 적을 쓰러뜨리고 목적지까지 간다', () => {
  const world = newWorld();
  const row = openRow(world, 14);
  const knight = spawnInRow(world, row, 'knight', 0, 0);
  const victim = spawnInRow(world, row, 'peasant', 1, 6);
  const goal = { x: row.x + 12.5, y: row.y + 0.5 };

  assert.equal(command(world, 0, { type: CMD.ATTACK_MOVE, unitIds: [knight.id], ...goal }), null);
  runSeconds(world, 20);
  assert.ok(!world.units.has(victim.id), '가는 길의 농노를 공격하지 않았다');
  assert.equal(knight.state, UNIT_STATE.IDLE);
  assert.ok(Math.hypot(knight.x - goal.x, knight.y - goal.y) < 0.6, `목적지에서 멀다: ${knight.x}, ${knight.y}`);
});

test('농노는 스스로 싸우러 가지 않지만 공격 명령을 받으면 싸운다', () => {
  const world = newWorld();
  const row = openRow(world, 6);
  const mine = spawnInRow(world, row, 'peasant', 0, 0);
  const theirs = spawnInRow(world, row, 'peasant', 1, 2);

  runSeconds(world, 3);
  assert.deepEqual([mine.hp, theirs.hp], [60, 60]);
  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [mine.id], targetId: theirs.id }), null);
  runSeconds(world, 3);
  assert.ok(theirs.hp < 60);
});

test('내 편이나 없는 대상은 공격할 수 없다', () => {
  const world = newWorld();
  const [a, b] = [...world.units.values()].filter((u) => u.owner === 0);
  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [a.id], targetId: b.id }), REJECT.INVALID_TARGET);
  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [a.id], targetId: 99999 }), REJECT.INVALID_TARGET);
});
