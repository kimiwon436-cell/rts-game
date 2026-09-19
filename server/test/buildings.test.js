// 건물 규칙: 여럿이 지으면 빨라진다 · 팔면 비용 일부를 돌려받는다 · 영주관은 하나뿐 · 우리 팀 건물은 지나가고 적 건물은 막힌다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { buildSpeedMultiplier } from '@rune/shared/data/economy.js';
import { canSell, sellRefund } from '@rune/shared/rules/costs.js';
import { CMD, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

/**
 * 시험용 맵 (48×24, 풀밭). y 8–12의 가로 복도만 열어 두고 위아래는 바위로 막는다.
 * 본진은 복도에서 먼 왼쪽 위·오른쪽 아래 구석에 둔다 (영주관이 복도를 막지 않게)
 */
function corridorMap() {
  const W = 48;
  const H = 24;
  const tiles = new Uint8Array(W * H).fill(TERRAIN.GRASS);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inCorridor = y >= 8 && y <= 12;
      const inBase = (x < 8 && y < 6) || (x >= 40 && y >= 18);
      if (!inCorridor && !inBase && x >= 8 && x < 40) tiles[y * W + x] = TERRAIN.ROCK;
    }
  }
  return {
    id: 'corridor-test',
    width: W,
    height: H,
    tiles,
    starts: [
      { slot: 0, team: 0, keep: { x: 1, y: 1, w: 4, h: 4 } },
      { slot: 1, team: 1, keep: { x: 43, y: 19, w: 4, h: 4 } },
      { slot: 2, team: 0, keep: { x: 1, y: 19, w: 4, h: 4 } },
      { slot: 3, team: 1, keep: { x: 43, y: 1, w: 4, h: 4 } },
    ],
    goldMines: [],
    wells: [],
  };
}

const DUEL = [
  { uid: 'a', nickname: 'A', slot: 0 },
  { uid: 'b', nickname: 'B', slot: 1 },
];
const TEAMS = [
  { uid: 'a', nickname: 'A', slot: 0, team: 0 },
  { uid: 'b', nickname: 'B', slot: 1, team: 1 },
  { uid: 'c', nickname: 'C', slot: 2, team: 0 },
  { uid: 'd', nickname: 'D', slot: 3, team: 1 },
];

function setup(players = DUEL) {
  const map = corridorMap();
  if (players.length === 2) map.starts = map.starts.slice(0, 2);
  const world = new World(map, players);
  world.units.clear(); // 시작 농노는 치운다
  for (const player of world.players) Object.assign(player, { gold: 5000, wood: 5000, mana: 5000 });
  stepWorld(world);
  return world;
}

let seq = 0;
const command = (world, slot, cmd) =>
  stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]);
const reason = (result) => result.rejects[0]?.reason ?? null;
function run(world, seconds) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) events.push(...stepWorld(world).events);
  return events;
}

// ---------- 건설 속도 ----------

test('농노가 많을수록 빨리 짓는다 (명^0.8: 1명 1배 · 2명 1.7배 · 4명 3배 · 8명 5.3배)', () => {
  assert.equal(buildSpeedMultiplier(0), 0);
  assert.equal(buildSpeedMultiplier(1), 1);
  assert.ok(Math.abs(buildSpeedMultiplier(2) - 1.74) < 0.01);
  assert.ok(Math.abs(buildSpeedMultiplier(4) - 3.03) < 0.01);
  assert.ok(Math.abs(buildSpeedMultiplier(8) - 5.28) < 0.01);
  for (let n = 1; n < 12; n++) {
    assert.ok(buildSpeedMultiplier(n + 1) > buildSpeedMultiplier(n), '늘 빨라진다');
    assert.ok(buildSpeedMultiplier(n + 1) - buildSpeedMultiplier(n) <= 1, '한 명이 더해 주는 몫은 한 명 몫을 넘지 않는다');
  }
});

test('실제 공사: 농노 넷이 지으면 혼자 지을 때보다 세 배쯤 빨리 끝난다', () => {
  const timeWith = (builders) => {
    const world = setup();
    const peasants = Array.from({ length: builders }, (_, i) => world.spawnUnit('peasant', 0, 12.5 + (i % 4), 10.5 + Math.floor(i / 4) * 0.4));
    const ids = peasants.map((u) => u.id);
    assert.equal(reason(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'farmstead', x: 20, y: 9 })), null);
    const farm = [...world.buildings.values()].find((b) => b.type === 'farmstead');
    let ticks = 0;
    while (!farm.complete && ticks < 20 * 120) {
      stepWorld(world);
      if (farm.started) ticks++;
    }
    assert.ok(farm.complete);
    return ticks * TICK_SECONDS;
  };
  const alone = timeWith(1);
  const four = timeWith(4);
  assert.ok(Math.abs(alone - BUILDINGS.farmstead.buildTime) < 1.5, `혼자 ${alone}초`);
  assert.ok(alone / four > 2.6 && alone / four < 3.4, `넷이면 ${four}초 (${(alone / four).toFixed(2)}배)`);
});

// ---------- 판매 ----------

test('판매: 비용의 절반 × 남은 체력을 돌려받고 건물이 사라진다', () => {
  const world = setup();
  const barracks = world.spawnBuilding('barracks', 0, 20, 9, { complete: true });
  const before = { ...world.players[0] };
  const { rejects, events } = command(world, 0, { type: CMD.SELL_BUILDING, buildingId: barracks.id });
  assert.deepEqual(rejects, []);
  assert.ok(!world.buildings.has(barracks.id));
  const cost = BUILDINGS.barracks.cost;
  assert.equal(world.players[0].gold - before.gold, Math.floor(cost.gold * 0.5));
  assert.equal(world.players[0].wood - before.wood, Math.floor(cost.wood * 0.5));
  const sold = events.find(([code]) => code === GAME_EVENT.BUILDING_SOLD);
  assert.deepEqual(sold, [GAME_EVENT.BUILDING_SOLD, barracks.id, 0, 25, 75, 0]);
  assert.equal(world.nav.isBlocked(21, 10), false, '자리가 비었다');

  // 반쯤 부서진 건물은 그만큼 덜 돌려받는다
  const damaged = world.spawnBuilding('stables', 0, 30, 9, { complete: true });
  damaged.hp = damaged.maxHp / 2;
  const gold = world.players[0].gold;
  command(world, 0, { type: CMD.SELL_BUILDING, buildingId: damaged.id });
  assert.equal(world.players[0].gold - gold, Math.floor(BUILDINGS.stables.cost.gold * 0.25));
  assert.deepEqual(sellRefund('stables', 0.5), { gold: 25, wood: 50, mana: 0 });
});

test('판매: 생산 대기열은 전액 돌려주고, 농가를 팔면 인구 상한이 준다', () => {
  const world = setup();
  const barracks = world.spawnBuilding('barracks', 0, 20, 9, { complete: true });
  const farm = world.spawnBuilding('farmstead', 0, 28, 9, { complete: true });
  stepWorld(world);
  const cap = world.players[0].popCap;
  command(world, 0, { type: CMD.TRAIN, buildingId: barracks.id, unit: 'pikeman' });
  command(world, 0, { type: CMD.TRAIN, buildingId: barracks.id, unit: 'pikeman' });
  const gold = world.players[0].gold;
  command(world, 0, { type: CMD.SELL_BUILDING, buildingId: barracks.id });
  assert.equal(world.players[0].gold - gold, Math.floor(BUILDINGS.barracks.cost.gold * 0.5) + UNITS.pikeman.cost.gold * 2);

  command(world, 0, { type: CMD.SELL_BUILDING, buildingId: farm.id });
  stepWorld(world);
  assert.equal(world.players[0].popCap, cap - BUILDINGS.farmstead.pop);
});

test('판매할 수 없는 것: 영주관 · 짓는 중인 건물 · 남의 건물', () => {
  const world = setup();
  const keep = [...world.buildings.values()].find((b) => b.owner === 0 && b.type === 'keep');
  assert.equal(canSell('keep'), false);
  assert.equal(reason(command(world, 0, { type: CMD.SELL_BUILDING, buildingId: keep.id })), REJECT.CANNOT_SELL);
  assert.ok(world.buildings.has(keep.id));

  const site = world.spawnBuilding('barracks', 0, 20, 9);
  assert.equal(reason(command(world, 0, { type: CMD.SELL_BUILDING, buildingId: site.id })), REJECT.INVALID_TARGET, '짓는 중이면 건설 취소');
  const theirs = world.spawnBuilding('barracks', 1, 30, 9, { complete: true });
  assert.equal(reason(command(world, 0, { type: CMD.SELL_BUILDING, buildingId: theirs.id })), REJECT.INVALID_TARGET);
});

test('영주관은 새로 지을 수 없다', () => {
  const world = setup();
  const peasant = world.spawnUnit('peasant', 0, 12.5, 10.5);
  assert.equal(reason(command(world, 0, { type: CMD.PLACE, unitIds: [peasant.id], building: 'keep', x: 20, y: 8 })), REJECT.INVALID);
  assert.equal([...world.buildings.values()].filter((b) => b.type === 'keep').length, 2);
});

// ---------- 지나가기 ----------

/** 복도를 가로막는 3×3 병영: 복도(y 8–12) 한가운데 */
const wall = (world, owner) => {
  const b = world.spawnBuilding('barracks', owner, 22, 8, { complete: true });
  // 복도 폭이 5칸이니 병영 위아래 한 칸씩을 바위로 막아 완전히 가로막는다
  for (const y of [11, 12]) {
    for (let x = 22; x < 25; x++) {
      world.tiles[y * world.width + x] = TERRAIN.ROCK;
      world.nav.setTile(y * world.width + x, 1);
      for (const nav of world.teamNav) nav.setTile(y * world.width + x, 1);
    }
  }
  return b;
};

test('우리 건물은 지나가고, 상대 건물은 부숴야 지나간다', () => {
  const world = setup();
  wall(world, 0);
  const mine = world.spawnUnit('pikeman', 0, 14.5, 9.5);
  const theirs = world.spawnUnit('pikeman', 1, 14.5, 10.5);
  const goal = { x: 32, y: 9, w: 1, h: 1 };
  assert.equal(world.moveUnit(mine, goal, false), true, '우리 병영을 지나 복도 건너편으로');
  assert.equal(world.moveUnit(theirs, goal, false), false, '적 병영에 막혀 건너가지 못한다');

  // 실제로 걸어서 건너간다
  command(world, 0, { type: CMD.MOVE, unitIds: [mine.id], x: 32.5, y: 9.5 });
  run(world, 10);
  assert.ok(mine.x > 30, `우리 창병이 건너갔다 (x ${mine.x.toFixed(1)})`);
  command(world, 1, { type: CMD.MOVE, unitIds: [theirs.id], x: 32.5, y: 9.5 });
  run(world, 10);
  assert.ok(theirs.x < 22, `적 창병은 병영 앞에서 멈췄다 (x ${theirs.x.toFixed(1)})`);
});

test('팀전: 팀원의 건물도 지나간다', () => {
  const world = setup(TEAMS);
  wall(world, 2); // 팀원(슬롯 2)의 병영
  const mine = world.spawnUnit('knight', 0, 14.5, 9.5);
  const enemy = world.spawnUnit('knight', 3, 14.5, 10.5);
  assert.equal(world.moveUnit(mine, { x: 32, y: 9, w: 1, h: 1 }, false), true);
  assert.equal(world.moveUnit(enemy, { x: 32, y: 9, w: 1, h: 1 }, false), false);
});

test('지나갈 수는 있어도 우리 건물 안에 멈춰 서지는 않는다', () => {
  const world = setup();
  const barracks = wall(world, 0);
  const mine = world.spawnUnit('pikeman', 0, 14.5, 9.5);
  command(world, 0, { type: CMD.MOVE, unitIds: [mine.id], x: 23.5, y: 9.5 }); // 병영 한가운데를 찍는다
  run(world, 8);
  const inside = mine.x >= barracks.x && mine.x < barracks.x + 3 && mine.y >= barracks.y && mine.y < barracks.y + 3;
  assert.equal(inside, false, `병영 밖에 선다 (${mine.x.toFixed(1)}, ${mine.y.toFixed(1)})`);
});

test('적이 막아선 건물을 부수면 길이 열린다', () => {
  const world = setup();
  const barracks = wall(world, 0);
  const theirs = world.spawnUnit('pikeman', 1, 14.5, 10.5);
  const goal = { x: 32, y: 9, w: 1, h: 1 };
  assert.equal(world.moveUnit(theirs, goal, false), false);
  barracks.hp = 0;
  stepWorld(world);
  assert.equal(world.moveUnit(theirs, goal, false), true);
});
