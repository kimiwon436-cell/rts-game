// 3-5 동기화: 서버가 만든 델타를 클라이언트 월드에 그대로 먹여 보고 상태가 같은지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD } from '@rune/shared/protocol.js';
import { World } from '../../server/src/game/World.js';
import { stepWorld } from '../../server/src/game/Simulation.js';
import { SnapshotFeed } from '../../server/src/game/sync/snapshot.js';
import { ClientWorld } from '../src/world/ClientWorld.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];
const MY_SLOT = 0;

function setup() {
  const map = loadMap('duel01');
  const world = new World(map, PLAYERS);
  const feed = new SnapshotFeed(world);
  const client = new ClientWorld(loadMap('duel01'), MY_SLOT);
  return { map, world, feed, client };
}

/** 한 틱 진행하고 그 틱의 개인화된 델타를 클라이언트에 적용한다 */
function tick(world, feed, client, commands = []) {
  const { events } = stepWorld(world, commands);
  feed.update(world, events);
  const snap = feed.snapshotFor(world, MY_SLOT);
  client.applySnapshot(snap);
  return snap;
}

const sortById = (a, b) => (a.id < b.id ? -1 : 1);

/** 전장의 안개: 클라이언트는 우리 팀 것과 보이는 적만 안다 */
const visibleUnits = (world) => [...world.units.values()].filter((u) => world.isVisibleTo(world.teamOf(MY_SLOT), u));
const visibleBuildings = (world) => [...world.buildings.values()].filter((b) => world.isVisibleTo(world.teamOf(MY_SLOT), b));

function assertSameState(world, client) {
  const units = visibleUnits(world);
  assert.ok(units.length < world.units.size, '상대 본진은 안개 속이라 오지 않는다');
  assert.equal(client.units.size, units.length);
  for (const unit of units) {
    const mirror = client.units.get(unit.id);
    assert.ok(mirror, `유닛 ${unit.id}이(가) 클라이언트에 없다`);
    assert.equal(mirror.type, unit.type);
    assert.equal(mirror.owner, unit.owner);
    assert.ok(Math.abs(mirror.x - unit.x) < 0.04, `${unit.id} x ${mirror.x} ≠ ${unit.x}`);
    assert.ok(Math.abs(mirror.y - unit.y) < 0.04, `${unit.id} y ${mirror.y} ≠ ${unit.y}`);
    assert.equal(mirror.hp, Math.ceil(unit.hp));
    assert.equal(mirror.state, unit.state);
    assert.equal(mirror.carryAmount, unit.carry ? unit.carry.amount : 0);
  }
  const buildings = visibleBuildings(world);
  assert.equal(client.buildings.size, buildings.length);
  for (const building of buildings) {
    const mirror = client.buildings.get(building.id);
    assert.ok(mirror, `건물 ${building.id}이(가) 클라이언트에 없다`);
    assert.equal(mirror.complete, building.complete);
    assert.equal(mirror.hp, Math.ceil(building.hp));
  }
}

test('델타만 이어 받아도 클라이언트 상태가 서버와 같다', () => {
  const { world, feed, client } = setup();

  // 첫 틱은 보이는 것 전체가 addU/addB로 들어온다 (내 농노 4, 내 영주관 — 상대 본진은 안개 속)
  const first = tick(world, feed, client);
  assert.equal(first.addU.length, 4);
  assert.equal(first.addB.length, 1);
  assertSameState(world, client);

  // 농노 두 기를 금광으로 보내고 20초를 델타로만 따라간다 (채취 → 반납 → 다시 채취)
  const mine = world.map.goldMines[0];
  const peasants = [...world.units.values()].filter((u) => u.owner === MY_SLOT).sort(sortById);
  tick(world, feed, client, [
    { slot: MY_SLOT, cmd: { seq: 1, type: CMD.GATHER, unitIds: peasants.slice(0, 2).map((u) => u.id), mineId: mine.id } },
  ]);
  for (let i = 0; i < 400; i++) tick(world, feed, client);

  assertSameState(world, client);
  assert.ok(client.me.gold > 200, '금이 늘어야 한다');
  assert.equal(client.mineAmounts.get(mine.id), world.mines.get(mine.id).amount);
});

test('움직이지 않는 틱의 델타는 전체 스냅샷보다 훨씬 작다', () => {
  const { world, feed, client } = setup();
  tick(world, feed, client);
  const idle = tick(world, feed, client); // 아무도 움직이지 않는 틱

  const full = feed.full(world, MY_SLOT);
  const size = (payload) => JSON.stringify(payload).length;
  assert.deepEqual(Object.keys(idle), ['t'], '아무것도 안 바뀐 틱은 틱 번호만 보낸다');
  assert.ok(size(idle) * 10 < size(full), `델타 ${size(idle)}B가 전체 ${size(full)}B보다 훨씬 작아야 한다`);
});

test('전체 스냅샷을 다시 받으면(재접속) 지난 상태를 버리고 새로 맞춘다', () => {
  const { world, feed, client } = setup();
  tick(world, feed, client);
  for (let i = 0; i < 40; i++) tick(world, feed, client);

  // 유령 유닛을 심어 두고 전체 스냅샷을 받으면 사라져야 한다
  client.units.set('ghost', { id: 'ghost', type: 'peasant', owner: 1, x: 5, y: 5, samples: [] });
  client.applySnapshot(feed.full(world, MY_SLOT));

  assert.equal(client.units.has('ghost'), false);
  assertSameState(world, client);
});

test('보간은 서버보다 두 틱 뒤의 위치를 그린다', () => {
  const { world, feed, client } = setup();
  tick(world, feed, client);
  const unit = [...world.units.values()].find((u) => u.owner === MY_SLOT);
  const target = { x: unit.x + 6, y: unit.y };
  tick(world, feed, client, [
    { slot: MY_SLOT, cmd: { seq: 1, type: CMD.MOVE, unitIds: [unit.id], x: target.x, y: target.y } },
  ]);
  for (let i = 0; i < 20; i++) tick(world, feed, client);

  const mirror = client.units.get(unit.id);
  client.updateDrawPositions(0.016); // 첫 프레임: renderTick = serverTick - 2로 맞춘다
  assert.equal(client.renderTick, client.serverTick - 2);
  assert.ok(mirror.drawX < mirror.x, '그리는 위치는 서버 위치보다 조금 뒤에 있다');
  assert.ok(mirror.x - mirror.drawX < 1, '두 틱(=100ms) 정도만 뒤처진다');

  // 스냅샷이 오지 않는 동안에도 프레임마다 앞으로 나아간다
  const before = mirror.drawX;
  for (let i = 0; i < 3; i++) client.updateDrawPositions(0.016);
  assert.ok(mirror.drawX > before, '보간이 이어져야 한다');
  assert.ok(mirror.drawX <= mirror.x + 0.001, '서버 위치를 앞지르지 않는다');
});
