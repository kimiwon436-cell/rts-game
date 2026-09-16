import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, GAME_EVENT, VICTORY_REASON } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];
const newWorld = () => new World(loadMap('duel01'), PLAYERS);
const keepOf = (world, slot) => [...world.buildings.values()].find((b) => b.owner === slot && b.type === 'keep');
const hasEvent = (events, code, slot) => events.some(([c, s]) => c === code && s === slot);

function runSeconds(world, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) stepWorld(world);
}

test('영주관을 모두 잃으면 왕관 몰락이 시작되고, 영주관을 다시 완성하면 취소된다', () => {
  const world = newWorld();
  const keep = keepOf(world, 1);
  keep.hp = 0;

  const { events } = stepWorld(world);
  assert.ok(!world.buildings.has(keep.id));
  assert.ok(events.some(([code, id]) => code === GAME_EVENT.BUILDING_DESTROYED && id === keep.id));
  assert.ok(hasEvent(events, GAME_EVENT.CROWN_FALLING, 1));
  assert.notEqual(world.players[1].collapseAt, null);

  world.spawnBuilding('keep', 1, keep.x, keep.y, { complete: true });
  const { events: after } = stepWorld(world);
  assert.ok(hasEvent(after, GAME_EVENT.CROWN_RESTORED, 1));
  assert.equal(world.players[1].collapseAt, null);
});

test('왕관 몰락 120초가 지나면 패배하고 상대가 이긴다', () => {
  const world = newWorld();
  keepOf(world, 1).hp = 0;

  runSeconds(world, 119);
  assert.equal(world.result, null, '120초 전에 끝났다');
  runSeconds(world, 2);
  assert.equal(world.result?.winnerTeam, 0);
  assert.equal(world.result?.reason, VICTORY_REASON.CONQUEST);
  assert.equal(world.players[1].defeated, true);
});

test('항복하면 바로 지고 상대가 이긴다', () => {
  const world = newWorld();
  stepWorld(world, [{ slot: 1, cmd: { seq: 1, type: CMD.SURRENDER, unitIds: [] } }]);
  assert.equal(world.result?.winnerTeam, 0);
  assert.equal(world.result?.reason, VICTORY_REASON.SURRENDER);
});

test('유닛도 건물도 남지 않으면 카운트다운 없이 바로 진다', () => {
  const world = newWorld();
  for (const unit of world.units.values()) if (unit.owner === 1) unit.hp = 0;
  keepOf(world, 1).hp = 0;

  stepWorld(world);
  assert.equal(world.result?.winnerTeam, 0);
  assert.equal(world.result?.reason, VICTORY_REASON.ANNIHILATION);
});
