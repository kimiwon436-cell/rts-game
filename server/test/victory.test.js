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

test('영주관이 무너지면 그 자리에서 지고 상대가 이긴다 (왕관 몰락)', () => {
  const world = newWorld();
  const keep = keepOf(world, 1);
  keep.hp = 0;

  const { events } = stepWorld(world);
  assert.ok(!world.buildings.has(keep.id));
  assert.ok(events.some(([code, id]) => code === GAME_EVENT.BUILDING_DESTROYED && id === keep.id));
  assert.ok(hasEvent(events, GAME_EVENT.PLAYER_DEFEATED, 1));
  assert.equal(world.players[1].defeated, true);
  assert.equal(world.result?.winnerTeam, 0);
  assert.equal(world.result?.reason, VICTORY_REASON.CONQUEST);
});

test('유닛이 아무리 많아도 영주관이 없으면 진다', () => {
  const world = newWorld();
  for (let i = 0; i < 10; i++) world.spawnUnit('knight', 1, 60.5, 20.5 + i);
  keepOf(world, 1).hp = 0;
  runSeconds(world, 0.2);
  assert.equal(world.players[1].defeated, true);
  assert.equal(world.result?.reason, VICTORY_REASON.CONQUEST);
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
