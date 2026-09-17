// 해군: 배는 물 위로만, 걷는 유닛은 다리로 강을 건넌다. 조선소는 물가에, 수송선은 물가에서 태우고 내린다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN, isBlockingTerrain, isNavigableWater } from '@rune/shared/map/grid.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { CMD, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

/**
 * 시험용 섬 (48×32): 위·아래 두 줄과 오른쪽(x ≥ 36)이 바다, x 14–16은 위아래로 흐르는 강,
 * 강 가운데(y 14–16)에 다리. 본진은 강 서쪽(2, 2)과 강과 바다 사이(24, 24).
 */
function testMap() {
  const W = 48;
  const H = 32;
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sea = y <= 1 || y >= H - 2 || x >= 36;
      const river = x >= 14 && x <= 16;
      if (sea || river) tiles[y * W + x] = river && y >= 14 && y <= 16 ? TERRAIN.BRIDGE : TERRAIN.WATER;
    }
  }
  return {
    id: 'naval-test',
    width: W,
    height: H,
    tiles,
    starts: [
      { slot: 0, team: 0, keep: { x: 3, y: 3, w: 4, h: 4 } },
      { slot: 1, team: 1, keep: { x: 24, y: 24, w: 4, h: 4 } },
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
  for (const player of world.players) Object.assign(player, { gold: 5000, wood: 5000, mana: 5000, age: 2 });
  world.units.clear(); // 시작 농노는 치운다 — 가까이 있는 적에게 싸우러 가서 해군 규칙을 흐리지 않게
  stepWorld(world);
  return world;
}
const command = (world, slot, cmd) =>
  stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]).rejects[0]?.reason ?? null;
/** seconds 동안 돌리며 틱마다 check(world)를 부른다 */
function run(world, seconds, check = () => {}) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
    events.push(...stepWorld(world).events);
    check(world);
  }
  return events;
}
const tileAt = (world, unit) => world.tiles[Math.floor(unit.y) * world.width + Math.floor(unit.x)];

test('배는 물 위로만 다니고, 뭍을 찍으면 가장 가까운 물로 간다', () => {
  const world = setup();
  const galley = world.spawnUnit('war_galley', 0, 40.5, 6.5);
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [galley.id], x: 25.5, y: 5.5 }), null, '뭍을 찍어도 명령은 받는다');
  run(world, 12, () => assert.ok(isNavigableWater(tileAt(world, galley)), `배가 뭍에 올라왔다 (${galley.x}, ${galley.y})`));
  assert.ok(Math.hypot(galley.x - 25.5, galley.y - 1) < 2, `찍은 곳에서 가장 가까운 물(위쪽 바다)에 닿았다 (${galley.x}, ${galley.y})`);
});

test('걷는 유닛은 다리로 강을 건너고, 배는 다리 밑을 지나간다. 둘은 서로 밀지 않는다', () => {
  const world = setup();
  const pike = world.spawnUnit('pikeman', 0, 8.5, 20.5);
  const galley = world.spawnUnit('war_galley', 0, 15.5, 4.5);
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [pike.id], x: 24.5, y: 8.5 }), null);
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [galley.id], x: 15.5, y: 20.5 }), null); // 적 영주관(24, 24)의 사거리 밖
  let crossedBridge = false;
  run(world, 20, () => {
    assert.ok(!isBlockingTerrain(tileAt(world, pike)), `창병이 물에 들어갔다 (${pike.x}, ${pike.y})`);
    assert.ok(isNavigableWater(tileAt(world, galley)), `배가 뭍에 올라왔다 (${galley.x}, ${galley.y})`);
    if (tileAt(world, pike) === TERRAIN.BRIDGE) crossedBridge = true;
  });
  assert.ok(Math.hypot(pike.x - 24.5, pike.y - 8.5) < 0.6, `창병이 강을 건넜다 (${pike.x}, ${pike.y})`);
  assert.ok(crossedBridge, '다리로 건넜다');
  assert.ok(Math.hypot(galley.x - 15.5, galley.y - 20.5) < 0.6, `배가 다리 밑을 지나갔다 (${galley.x}, ${galley.y})`);

  // 다리 위의 창병과 그 밑의 배가 한자리에 있어도 서로 밀어내지 않는다
  const soldier = world.spawnUnit('pikeman', 0, 15.5, 15.5);
  const boat = world.spawnUnit('war_galley', 0, 15.5, 15.6);
  run(world, 1);
  assert.deepEqual([soldier.x, soldier.y, boat.x, boat.y], [15.5, 15.5, 15.5, 15.6]);
});

test('조선소는 바다와 이어진 물가에만 짓고, 배는 조선소 옆 물에서 나와 집결지 가까운 물로 간다', () => {
  const world = setup();
  const place = (x, y) =>
    checkPlacement({ type: 'shipyard', x, y, map: world.map, tiles: world.tiles, occupied: world.occupied, isWellTaken: () => false });
  assert.equal(place(20, 8), PLACE.NEEDS_COAST, '물에서 먼 곳');
  assert.equal(place(32, 8), PLACE.NEEDS_COAST, '물가에서 한 칸 떨어졌다');
  assert.equal(place(33, 8), PLACE.OK, '바다에 닿았다');
  assert.equal(place(15, 20), PLACE.BLOCKED, '물 위에는 못 짓는다');
  assert.equal(place(14, 13), PLACE.BLOCKED, '다리 위에는 못 짓는다');

  const worker = world.spawnUnit('peasant', 0, 30.5, 12.5);
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: [worker.id], building: 'shipyard', x: 20, y: 8 }), REJECT.NEEDS_COAST);

  const shipyard = world.spawnBuilding('shipyard', 0, 33, 8, { complete: true });
  assert.equal(command(world, 0, { type: CMD.SET_RALLY, buildingId: shipyard.id, x: 29.5, y: 12.5 }), null, '집결지는 뭍 (바다가 강보다 가깝다)');
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: shipyard.id, unit: 'war_galley' }), null);
  let galley = null;
  run(world, 45, () => {
    galley ??= [...world.units.values()].find((u) => u.type === 'war_galley');
    if (galley) assert.ok(isNavigableWater(tileAt(world, galley)), `배는 늘 물 위에 있다 (${galley.x}, ${galley.y})`);
  });
  assert.ok(galley, '조선소에서 배가 나왔다');
  assert.ok(galley.x > 35.5, `집결지(뭍)에서 가장 가까운 물가로 갔다 (${galley.x}, ${galley.y})`);
});

test('근접 유닛은 배를 공격하지 못하고, 원거리 유닛과 배는 물 건너로 싸운다', () => {
  const world = setup();
  const galley = world.spawnUnit('war_galley', 1, 37.2, 20.5);
  const knight = world.spawnUnit('knight', 0, 34.5, 20.5);
  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [knight.id], targetId: galley.id }), REJECT.CANNOT_ATTACK);
  run(world, 3);
  assert.equal(galley.hp, 320, '기사는 배에 닿지 않는다 (스스로도 노리지 않는다)');
  assert.ok(knight.hp < 260, '갤리는 물가의 기사를 쏜다');

  const bow = world.spawnUnit('longbowman', 0, 32.5, 22.5);
  run(world, 4);
  assert.ok(galley.hp < 320, '장궁병은 배를 쏜다');
});

test('투석 전함은 물가의 건물을 크게 부순다 (공성 × 건물 2.5)', () => {
  const world = setup();
  const barracks = world.spawnBuilding('barracks', 0, 30, 9, { complete: true });
  const ship = world.spawnUnit('catapult_ship', 1, 38.5, 10.5);
  const start = barracks.hp;
  const events = run(world, 6);
  assert.ok(events.some(([code, id]) => code === GAME_EVENT.ATTACK && id === ship.id), '물에서 건물을 쏜다');
  assert.equal((start - barracks.hp) % 100, 0, '한 발에 40 × 2.5 = 100');
  assert.ok(barracks.hp < start);
});

test('수송선: 물가에서 태우고, 뭍 가까이에서만 내리며, 탄 유닛은 싸우지 않는다', () => {
  const world = setup();
  const transport = world.spawnUnit('transport_ship', 0, 36.9, 6.5);
  const riders = [
    world.spawnUnit('pikeman', 0, 31.5, 5.5),
    world.spawnUnit('longbowman', 0, 31.5, 7.5),
    world.spawnUnit('peasant', 0, 30.5, 6.5),
    world.spawnUnit('knight', 0, 29.5, 8.5),
  ];
  const solarion = world.spawnUnit('solarion', 0, 30.5, 10.5);
  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: [solarion.id], targetId: transport.id }), REJECT.CANNOT_BOARD, '궁극 유닛은 못 탄다');
  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: riders.map((u) => u.id), targetId: transport.id }), null);
  run(world, 5);
  assert.equal(transport.garrison.length, 4, '물가에 댄 수송선에 모두 탔다');
  assert.equal(transport.extra, 4, '스냅샷에 탑승 인원');

  // 탄 장궁병은 쏘지 않는다
  const enemy = world.spawnUnit('war_galley', 1, 40.5, 6.5);
  run(world, 2);
  assert.equal(enemy.hp, 320, '수송선 안에서는 싸우지 않는다');
  world.units.delete(enemy.id);

  // 바다 한가운데서는 못 내린다
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [transport.id], x: 42.5, y: 16.5 }), null);
  run(world, 5);
  assert.equal(command(world, 0, { type: CMD.USE_ABILITY, unitIds: [transport.id], ability: 'unload' }), REJECT.NO_LANDING);

  // 뭍에 대면 내린다
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [transport.id], x: 36.8, y: 18.5 }), null);
  run(world, 5);
  assert.equal(command(world, 0, { type: CMD.USE_ABILITY, unitIds: [transport.id], ability: 'unload' }), null);
  for (const rider of riders) {
    assert.equal(rider.carrierId, null);
    assert.ok(!isBlockingTerrain(tileAt(world, rider)), `뭍에 내렸다 (${rider.x}, ${rider.y})`);
  }
});

test('수송선이 가라앉으면 탄 유닛도 함께 잃는다', () => {
  const world = setup();
  const transport = world.spawnUnit('transport_ship', 0, 36.9, 6.5);
  const riders = [world.spawnUnit('pikeman', 0, 35.2, 6.5), world.spawnUnit('pikeman', 0, 35.2, 7.2)];
  riders.forEach((rider) => world.boardUnit(transport, rider));
  transport.hp = 0;
  run(world, 0.2);
  assert.equal(world.units.has(transport.id), false);
  for (const rider of riders) assert.equal(world.units.has(rider.id), false, '탄 유닛도 사라졌다');
});
