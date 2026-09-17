// 공군: 하늘로 곧장 날고, 근접 공격은 하늘에 닿지 않으며, 관통(장궁병·감시탑·갤리)이 천적이다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { UNITS } from '@rune/shared/data/units.js';
import { CMD, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

/** 시험용 섬 (48×32): 오른쪽(x ≥ 36)과 위·아래 두 줄이 바다, 가운데 x 20–23은 바위 능선 */
function testMap() {
  const W = 48;
  const H = 32;
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y <= 1 || y >= H - 2 || x >= 36) tiles[y * W + x] = TERRAIN.WATER;
      else if (x >= 20 && x <= 23) tiles[y * W + x] = TERRAIN.ROCK;
    }
  }
  return {
    id: 'air-test',
    width: W,
    height: H,
    tiles,
    starts: [
      { slot: 0, team: 0, keep: { x: 3, y: 3, w: 4, h: 4 } },
      { slot: 1, team: 1, keep: { x: 28, y: 24, w: 4, h: 4 } },
    ],
    goldMines: [],
    wells: [],
  };
}

const PLAYERS = [
  { uid: 'a', nickname: 'A', slot: 0 },
  { uid: 'b', nickname: 'B', slot: 1 },
];
let seq = 0;
function setup() {
  const world = new World(testMap(), PLAYERS);
  for (const player of world.players) Object.assign(player, { gold: 5000, wood: 5000, mana: 5000, age: 3 });
  world.units.clear(); // 시작 농노는 치운다 (근처 적에게 싸우러 가서 규칙을 흐리지 않게)
  stepWorld(world);
  return world;
}
const command = (world, slot, cmd) =>
  stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]).rejects[0]?.reason ?? null;
function run(world, seconds, check = () => {}) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
    events.push(...stepWorld(world).events);
    check(world);
  }
  return events;
}

test('공중 유닛은 바위 능선과 바다 위를 곧장 날아간다', () => {
  const world = setup();
  const gryphon = world.spawnUnit('gryphon_rider', 0, 6.5, 16.5);
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [gryphon.id], x: 40.5, y: 16.5 }), null, '바다 위도 찍을 수 있다');
  let overRock = false;
  let overWater = false;
  run(world, 12, () => {
    const tile = world.tiles[Math.floor(gryphon.y) * world.width + Math.floor(gryphon.x)];
    if (tile === TERRAIN.ROCK) overRock = true;
    if (tile === TERRAIN.WATER) overWater = true;
    assert.ok(Math.abs(gryphon.y - 16.5) < 0.2, `곧장 난다 (y=${gryphon.y})`);
  });
  assert.ok(overRock && overWater, '바위와 바다 위를 지나갔다');
  assert.ok(Math.hypot(gryphon.x - 40.5, gryphon.y - 16.5) < 0.4, `바다 위에 도착했다 (${gryphon.x}, ${gryphon.y})`);
});

test('근접 유닛은 하늘에 닿지 않고, 장궁병은 관통 두 배로 떨어뜨린다', () => {
  const world = setup();
  const gryphon = world.spawnUnit('gryphon_rider', 1, 10.5, 16.5);
  const knight = world.spawnUnit('knight', 0, 9.5, 16.5);
  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [knight.id], targetId: gryphon.id }), REJECT.CANNOT_ATTACK);
  run(world, 3);
  assert.equal(gryphon.hp, 300, '기사는 하늘을 때리지 못한다 (스스로도 노리지 않는다)');
  assert.ok(knight.hp < 260, '그리폰은 기사를 내리찍는다');

  const bow = world.spawnUnit('longbowman', 0, 14.5, 16.5);
  const before = gryphon.hp;
  run(world, 4);
  assert.ok(gryphon.hp <= before - 24, `장궁병은 12 × 2 = 24씩 맞힌다 (${before} → ${gryphon.hp})`);
});

test('감시탑과 전투 갤리도 하늘을 쏘고, 그리폰은 배를 덮친다', () => {
  const world = setup();
  const tower = world.spawnBuilding('watchtower', 0, 12, 12, { complete: true });
  const scout = world.spawnUnit('falcon_scout', 1, 16.5, 13.5);
  run(world, 3);
  assert.ok(scout.hp < 90, '감시탑이 정찰기를 쏜다');

  const galley = world.spawnUnit('war_galley', 0, 38.5, 16.5);
  const gryphon = world.spawnUnit('gryphon_rider', 1, 37.5, 16.5);
  run(world, 3);
  assert.ok(galley.hp < 320, '그리폰이 배를 덮친다');
  assert.ok(gryphon.hp < 300, '갤리도 하늘을 쏜다 (관통 ×2)');
});

test('폭풍 비룡은 건물을 크게 부수지만 하늘은 때리지 못한다', () => {
  const world = setup();
  const barracks = world.spawnBuilding('barracks', 0, 8, 8, { complete: true });
  const wyvern = world.spawnUnit('storm_wyvern', 1, 12.5, 9.5);
  const start = barracks.hp;
  const events = run(world, 8);
  assert.ok(events.some(([code, id]) => code === GAME_EVENT.ATTACK && id === wyvern.id), '건물을 폭격한다');
  const lost = start - barracks.hp;
  assert.ok(lost > 0 && Math.abs(lost % 112.5) < 1e-6, `한 발에 45 × 건물 2.5 = 112.5 (${lost} 깎임)`);

  const scout = world.spawnUnit('falcon_scout', 0, 13.5, 9.5);
  assert.equal(command(world, 1, { type: CMD.ATTACK, unitIds: [wyvern.id], targetId: scout.id }), REJECT.CANNOT_ATTACK);
  run(world, 3);
  assert.equal(scout.hp, 90, '공성 피해는 하늘에 닿지 않는다');
});

test('매 정찰병은 싸우지 않고 멀리 본다', () => {
  const world = setup();
  const scout = world.spawnUnit('falcon_scout', 0, 8.5, 16.5);
  const enemy = world.spawnUnit('pikeman', 1, 10.5, 16.5);
  run(world, 3);
  assert.equal(enemy.hp, 110, '정찰기는 공격하지 않는다');
  assert.equal(UNITS.falcon_scout.sight, 13);
  assert.ok(world.vision.isVisible(0, 8.5 + 12, 16.5), '12칸 밖도 본다');
  assert.equal(world.vision.isVisible(0, 8.5 + 14, 16.5), false);
});

test('공중 유닛은 수송선에 타지 않고, 땅·물 위 유닛과 서로 밀지 않는다', () => {
  const world = setup();
  const transport = world.spawnUnit('transport_ship', 0, 36.6, 16.5);
  const gryphon = world.spawnUnit('gryphon_rider', 0, 34.5, 16.5);
  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: [gryphon.id], targetId: transport.id }), REJECT.CANNOT_BOARD);

  const pike = world.spawnUnit('pikeman', 0, 15.5, 16.5);
  const flyer = world.spawnUnit('falcon_scout', 0, 15.5, 16.6);
  run(world, 1);
  assert.deepEqual([pike.x, pike.y, flyer.x, flyer.y], [15.5, 16.5, 15.5, 16.6], '머리 위를 날아도 밀리지 않는다');
});

test('그리폰 둥지에서 나온 공중 유닛은 집결지로 곧장 난다', () => {
  const world = setup();
  const aerie = world.spawnBuilding('aerie', 0, 8, 12, { complete: true });
  assert.equal(command(world, 0, { type: CMD.SET_RALLY, buildingId: aerie.id, x: 40.5, y: 20.5 }), null, '집결지는 바다 위여도 된다');
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: aerie.id, unit: 'falcon_scout' }), null);
  run(world, 16);
  const scout = [...world.units.values()].find((u) => u.type === 'falcon_scout');
  assert.ok(scout, '둥지에서 정찰기가 나왔다');
  run(world, 8);
  assert.ok(Math.hypot(scout.x - 40.5, scout.y - 20.5) < 1, `바다 위 집결지까지 날아갔다 (${scout.x}, ${scout.y})`);
});
