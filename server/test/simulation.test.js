import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { CMD, GAME_EVENT, REJECT, UNIT_STATE } from '@rune/shared/protocol.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];

const newWorld = () => new World(loadMap('duel01'), PLAYERS);
const peasantsOf = (world, slot) => [...world.units.values()].filter((u) => u.owner === slot && u.type === 'peasant');
const buildingOf = (world, type) => [...world.buildings.values()].find((b) => b.type === type);

let seq = 0;
/** 명령 하나를 넣고 한 틱 진행한다. 거부되면 이유를, 아니면 null을 돌려준다. */
function command(world, slot, cmd) {
  const { rejects } = stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]);
  return rejects[0]?.reason ?? null;
}

function runSeconds(world, seconds) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) events.push(...stepWorld(world).events);
  return events;
}

/** near 주변에서 건물을 놓을 수 있는 자리를 찾는다 */
function findSpot(world, type, near) {
  for (let r = 0; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near.x + dx;
        const y = near.y + dy;
        const result = checkPlacement({
          type,
          x,
          y,
          map: world.map,
          tiles: world.tiles,
          occupied: world.occupied,
          isWellTaken: (id) => world.isWellTaken(id),
        });
        if (result === PLACE.OK) return { x, y };
      }
    }
  }
  throw new Error(`${type}을 놓을 자리를 찾지 못했다`);
}

test('시작하면 영주관 1채와 농노 4기, 금 200·목재 200을 갖는다', () => {
  const world = newWorld();
  for (const slot of [0, 1]) {
    const buildings = [...world.buildings.values()].filter((b) => b.owner === slot);
    assert.deepEqual(buildings.map((b) => [b.type, b.complete]), [['keep', true]]);
    assert.equal(peasantsOf(world, slot).length, 4);
    const p = world.players[slot];
    assert.deepEqual([p.gold, p.wood, p.mana, p.pop, p.popCap], [200, 200, 0, 4, 10]);
  }
});

test('농노가 금광에서 금을 캐 영주관에 반납한다', () => {
  const world = newWorld();
  const workers = peasantsOf(world, 0);
  const mine = world.mines.get('gold0');
  const before = mine.amount;

  assert.equal(command(world, 0, { type: CMD.GATHER, unitIds: workers.map((u) => u.id), mineId: 'gold0' }), null);
  runSeconds(world, 60);

  const gold = world.players[0].gold;
  const carried = workers.reduce((sum, u) => sum + (u.carry?.kind === 'gold' ? u.carry.amount : 0), 0);
  assert.ok(gold >= 300, `60초 동안 금이 충분히 늘지 않았다: ${gold}`);
  assert.equal(before - mine.amount, gold - 200 + carried, '캔 양 = 반납한 양 + 들고 있는 양');
});

test('나무를 다 베면 풀밭이 되고 목재가 쌓인다', () => {
  const world = newWorld();
  const [worker] = peasantsOf(world, 0);
  const tile = world.treesNear(worker.x, worker.y, 30)[0];

  assert.equal(command(world, 0, { type: CMD.GATHER, unitIds: [worker.id], tile }), null);
  const events = runSeconds(world, 300);
  const felled = events.filter(([code]) => code === GAME_EVENT.TREE_FELLED).map(([, t]) => t);

  assert.ok(felled.length >= 1, '5분 동안 나무를 하나도 베지 못했다');
  assert.equal(world.tiles[felled[0]], TERRAIN.GRASS);
  assert.equal(world.nav.blocked[felled[0]], 0);
  assert.ok(world.players[0].wood >= 300);
});

test('농가를 놓으면 목재가 빠지고, 다 지으면 인구 상한이 8 늘어난다', () => {
  const world = newWorld();
  const [a, b] = peasantsOf(world, 0);
  const spot = findSpot(world, 'farmstead', { x: 21, y: 80 });

  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: [a.id, b.id], building: 'farmstead', ...spot }), null);
  assert.equal(world.players[0].wood, 140);
  const farm = buildingOf(world, 'farmstead');
  assert.equal(farm.complete, false);

  runSeconds(world, 40);
  assert.equal(farm.complete, true);
  assert.equal(world.players[0].popCap, 18);
  assert.equal(a.state, UNIT_STATE.IDLE);
  assert.ok(!world.nav.isBlocked(Math.floor(a.x), Math.floor(a.y)), '농노가 건물 안에 갇혔다');
});

test('막힌 자리, 샘이 아닌 곳의 오벨리스크, 부족한 자원과 시대, 남의 농노는 거부한다', () => {
  const world = newWorld();
  const ids = peasantsOf(world, 0).map((u) => u.id);
  const keep = world.map.starts[0].keep;
  const spot = findSpot(world, 'farmstead', { x: 21, y: 80 });

  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'farmstead', x: keep.x, y: keep.y }), REJECT.BLOCKED);
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'obelisk', ...spot }), REJECT.NEEDS_WELL);
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'keep', ...spot }), REJECT.INVALID, '영주관은 새로 짓지 못한다');
  world.players[0].gold = 10;
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'barracks', ...spot }), REJECT.NOT_ENOUGH_GOLD);
  world.players[0].gold = 200;
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'market', ...spot }), REJECT.REQUIRES_AGE);
  assert.equal(command(world, 1, { type: CMD.PLACE, unitIds: ids, building: 'farmstead', ...spot }), REJECT.NO_WORKER);
  assert.deepEqual([world.players[0].gold, world.players[0].wood], [200, 200]);
});

test('마나 샘 위 오벨리스크가 완성되면 초당 1.5 마나가 쌓이고, 같은 샘에는 또 지을 수 없다', () => {
  const world = newWorld();
  const well = world.map.wells.find((w) => w.kind === 'home' && w.y > 48);
  world.spawnBuilding('obelisk', 0, well.x, well.y, { complete: true });

  runSeconds(world, 10);
  assert.ok(Math.abs(world.players[0].mana - 15) < 1e-6, `마나: ${world.players[0].mana}`);

  const ids = peasantsOf(world, 0).map((u) => u.id);
  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: ids, building: 'obelisk', x: well.x, y: well.y }), REJECT.WELL_TAKEN);
});

test('병영이 있어야 성채 시대로 발전하고, 60초 뒤 시대가 오른다', () => {
  const world = newWorld();
  const player = world.players[0];
  Object.assign(player, { gold: 1000, wood: 1000, mana: 500 });

  assert.equal(command(world, 0, { type: CMD.AGE_UP }), REJECT.REQUIRES_BUILDING);
  const spot = findSpot(world, 'barracks', { x: 22, y: 78 });
  world.spawnBuilding('barracks', 0, spot.x, spot.y, { complete: true });

  assert.equal(command(world, 0, { type: CMD.AGE_UP }), null);
  assert.deepEqual([player.gold, player.wood, player.mana], [700, 800, 400]);
  assert.equal(command(world, 0, { type: CMD.AGE_UP }), REJECT.AGE_IN_PROGRESS);

  runSeconds(world, 61);
  assert.equal(player.age, 2);
  // 왕국 시대는 성채 시대 건물 2종이 있어야 한다
  assert.equal(command(world, 0, { type: CMD.AGE_UP }), REJECT.REQUIRES_BUILDING);
});

test('시장에서 목재를 사면 금 115가 빠지고 시세가 5% 오른다', () => {
  const world = newWorld();
  const player = world.players[0];

  assert.equal(command(world, 0, { type: CMD.TRADE, resource: 'wood', action: 'buy' }), REJECT.NO_MARKET);
  const spot = findSpot(world, 'market', { x: 22, y: 78 });
  world.spawnBuilding('market', 0, spot.x, spot.y, { complete: true });

  assert.equal(command(world, 0, { type: CMD.TRADE, resource: 'wood', action: 'buy' }), null);
  assert.equal(player.gold, 85);
  assert.equal(player.wood, 300);
  assert.ok(player.market.wood > 104.9 && player.market.wood <= 105, `시세: ${player.market.wood}`);
  assert.equal(command(world, 0, { type: CMD.TRADE, resource: 'wood', action: 'buy' }), REJECT.NOT_ENOUGH_GOLD);
});

test('건설을 취소하면 짓지 않은 만큼 돌려받는다', () => {
  const world = newWorld();
  const [worker] = peasantsOf(world, 0);
  const spot = findSpot(world, 'barracks', { x: 22, y: 78 });

  assert.equal(command(world, 0, { type: CMD.PLACE, unitIds: [worker.id], building: 'barracks', ...spot }), null);
  const barracks = buildingOf(world, 'barracks');
  assert.deepEqual([world.players[0].gold, world.players[0].wood], [150, 50]);

  assert.equal(command(world, 0, { type: CMD.CANCEL_BUILD, buildingId: barracks.id }), null);
  assert.deepEqual([world.players[0].gold, world.players[0].wood], [200, 200]);
  assert.equal(world.buildings.has(barracks.id), false);
  assert.equal(worker.state, UNIT_STATE.IDLE);
});

test('이동 명령을 받은 유닛은 목표 지점에 도착하면 멈춘다', () => {
  const world = newWorld();
  const [worker] = peasantsOf(world, 0);
  const target = { x: worker.x + 6.25, y: worker.y - 3.5 };

  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [worker.id], ...target }), null);
  assert.equal(worker.state, UNIT_STATE.MOVE);
  runSeconds(world, 10);
  assert.equal(worker.state, UNIT_STATE.IDLE);
  assert.ok(Math.hypot(worker.x - target.x, worker.y - target.y) < 0.01);
});
