import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, GAME_EVENT, REJECT, UNIT_STATE } from '@rune/shared/protocol.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { World, distanceToRect } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];
const newWorld = () => new World(loadMap('duel01'), PLAYERS);
const unitsOf = (world, slot, type) => [...world.units.values()].filter((u) => u.owner === slot && u.type === type);
const keepOf = (world, slot) => [...world.buildings.values()].find((b) => b.owner === slot && b.type === 'keep');

let seq = 0;
function command(world, slot, cmd) {
  const { rejects } = stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]);
  return rejects[0]?.reason ?? null;
}

function runSeconds(world, seconds) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) events.push(...stepWorld(world).events);
  return events;
}

function spawnCompleted(world, type, slot, near) {
  for (let r = 0; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near.x + dx;
        const y = near.y + dy;
        const ok = checkPlacement({
          type, x, y, map: world.map, tiles: world.tiles, occupied: world.occupied, isWellTaken: (id) => world.isWellTaken(id),
        });
        if (ok === PLACE.OK) return world.spawnBuilding(type, slot, x, y, { complete: true });
      }
    }
  }
  throw new Error(`${type}을 놓을 자리를 찾지 못했다`);
}

test('영주관에서 농노를 뽑으면 금 50이 빠지고 12초 뒤 영주관 옆에 나온다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);

  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' }), null);
  assert.equal(world.players[0].gold, 150);
  assert.equal(keep.queue.length, 1);

  runSeconds(world, 11);
  assert.equal(unitsOf(world, 0, 'peasant').length, 4, '12초 전에 나왔다');

  const events = runSeconds(world, 1.5);
  const peasants = unitsOf(world, 0, 'peasant');
  assert.equal(peasants.length, 5);
  assert.ok(events.some(([code]) => code === GAME_EVENT.TRAINED));
  assert.ok(distanceToRect(peasants.at(-1).x, peasants.at(-1).y, keep) < 1.5, '영주관에서 먼 곳에 나왔다');
  assert.equal(world.players[0].pop, 5);
});

test('인구 상한이 모자라면 100%에서 기다렸다가 농가가 완성되면 나온다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);
  for (let i = 0; i < 6; i++) world.spawnUnitNear('peasant', 0, keep, { x: 48, y: 48 });

  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' }), null);
  runSeconds(world, 13);
  assert.equal(unitsOf(world, 0, 'peasant').length, 10);
  assert.equal(keep.queue[0].blocked, true);

  spawnCompleted(world, 'farmstead', 0, { x: 21, y: 80 });
  runSeconds(world, 0.1);
  assert.equal(unitsOf(world, 0, 'peasant').length, 11);
  assert.equal(keep.queue.length, 0);
});

test('대기열이 가득 찼거나, 시대가 낮거나, 그 건물이 만들 수 없거나, 남의·짓는 중인 건물이면 거부한다', () => {
  const world = newWorld();
  Object.assign(world.players[0], { gold: 5000, wood: 5000 });
  const keep = keepOf(world, 0);

  for (let i = 0; i < 5; i++) assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' }), null);
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' }), REJECT.QUEUE_FULL);

  const stables = spawnCompleted(world, 'stables', 0, { x: 22, y: 76 });
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: stables.id, unit: 'knight' }), REJECT.REQUIRES_AGE);
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: stables.id, unit: 'pikeman' }), REJECT.INVALID);
  assert.equal(command(world, 1, { type: CMD.TRAIN, buildingId: stables.id, unit: 'scout_rider' }), REJECT.INVALID_TARGET);

  const [worker] = unitsOf(world, 0, 'peasant');
  const site = spawnCompleted(world, 'barracks', 0, { x: 26, y: 70 });
  site.complete = false;
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: site.id, unit: 'pikeman', unitIds: [worker.id] }), REJECT.INVALID_TARGET);
});

test('생산을 취소하면 비용을 모두 돌려받는다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);
  command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' });
  command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' });
  assert.equal(world.players[0].gold, 100);

  assert.equal(command(world, 0, { type: CMD.CANCEL_TRAIN, buildingId: keep.id, index: 1 }), null);
  assert.equal(world.players[0].gold, 150);
  assert.equal(keep.queue.length, 1);
  assert.equal(command(world, 0, { type: CMD.CANCEL_TRAIN, buildingId: keep.id, index: 5 }), REJECT.INVALID_TARGET);
});

test('집결지를 금광에 찍으면 새 농노가 바로 그 금광을 캐러 간다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);

  assert.equal(command(world, 0, { type: CMD.SET_RALLY, buildingId: keep.id, x: 8.5, y: 71.5, mineId: 'gold0' }), null);
  assert.deepEqual(keep.rally, { x: 8.5, y: 71.5, mineId: 'gold0', tile: null });

  command(world, 0, { type: CMD.TRAIN, buildingId: keep.id, unit: 'peasant' });
  runSeconds(world, 13);
  const newest = unitsOf(world, 0, 'peasant').at(-1);
  assert.equal(newest.order?.type, 'gather');
  assert.equal(newest.order.mineId, 'gold0');
});

test('병영에서 뽑은 창병이 집결지까지 걸어가 멈춘다', () => {
  const world = newWorld();
  Object.assign(world.players[0], { gold: 1000, wood: 1000 });
  const barracks = spawnCompleted(world, 'barracks', 0, { x: 22, y: 78 });
  const [rx, ry] = world.nearestFreeTile(30.5, 70.5);
  const rally = { x: rx + 0.5, y: ry + 0.5 };

  assert.equal(command(world, 0, { type: CMD.SET_RALLY, buildingId: barracks.id, ...rally }), null);
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: barracks.id, unit: 'pikeman' }), null);
  runSeconds(world, 18 + 10);

  const [pikeman] = unitsOf(world, 0, 'pikeman');
  assert.ok(pikeman, '창병이 나오지 않았다');
  assert.equal(pikeman.state, UNIT_STATE.IDLE);
  assert.ok(Math.hypot(pikeman.x - rally.x, pikeman.y - rally.y) < 0.6, `집결지에서 멀다: ${pikeman.x}, ${pikeman.y}`);
});
