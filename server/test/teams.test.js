// 팀전 규칙: 같은 팀은 싸우지 않고, 이로운 효과를 나누고, 한 팀이 모두 져야 경기가 끝난다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, REJECT, VICTORY_REASON } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS_2V2 = [
  { uid: 'a', nickname: 'A', slot: 0, team: 0 },
  { uid: 'b', nickname: 'B', slot: 1, team: 1 },
  { uid: 'c', nickname: 'C', slot: 2, team: 0 },
  { uid: 'd', nickname: 'D', slot: 3, team: 1 },
];
const newWorld = () => new World(loadMap('team01'), PLAYERS_2V2);
let seq = 0;
const command = (world, slot, cmd) =>
  stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]).rejects[0]?.reason ?? null;
const runSeconds = (world, seconds) => {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) stepWorld(world);
};

test('2대2: 네 본진이 맵의 팀 위치에 서고, 같은 팀끼리는 적이 아니다', () => {
  const world = newWorld();
  for (const player of world.players) {
    const keep = [...world.buildings.values()].find((b) => b.owner === player.slot && b.type === 'keep');
    const start = world.map.starts[player.slot];
    assert.deepEqual([keep.x, keep.y], [start.keep.x, start.keep.y]);
    assert.equal(start.team, player.team);
  }
  assert.equal(world.areEnemies(0, 2), false);
  assert.equal(world.areEnemies(0, 1), true);
  assert.equal(world.areEnemies(3, 1), false);
});

test('같은 팀 유닛은 서로 공격하지 않고, 공격 명령도 거부한다', () => {
  const world = newWorld();
  const mine = world.spawnUnit('knight', 0, 60, 60);
  const ally = world.spawnUnit('pikeman', 2, 60.8, 60);
  runSeconds(world, 2);
  assert.equal(ally.hp, 110, '옆에 있어도 아군은 때리지 않는다');
  assert.equal(mine.hp, 260);

  assert.equal(command(world, 0, { type: CMD.ATTACK, unitIds: [mine.id], targetId: ally.id }), REJECT.INVALID_TARGET);

  const enemy = world.spawnUnit('pikeman', 1, 59.2, 60);
  runSeconds(world, 2);
  assert.ok(enemy.hp < 110, '적은 알아서 때린다');
});

test('범위 피해는 아군을 비껴가고, 새벽의 오라는 팀원에게도 닿는다', () => {
  const world = newWorld();
  world.players[0].oath = 'crown';
  const mage = world.spawnUnit('battlemage', 0, 60, 60);
  const enemy = world.spawnUnit('royal_guard', 1, 64, 60);
  const allyNextToEnemy = world.spawnUnit('royal_guard', 2, 64.6, 60.2);
  enemy.stunUntil = 10_000; // 적이 옆의 아군을 때리지 못하게 묶어 두고, 마법사의 범위 피해만 본다
  runSeconds(world, 3);
  assert.ok(enemy.hp < 240, '마법사가 적을 맞힌다');
  assert.equal(allyNextToEnemy.hp, 240, '같은 팀은 범위 피해를 받지 않는다');
  assert.ok(mage.hp > 0);

  const world2 = newWorld();
  world2.players[0].oath = 'crown';
  world2.spawnUnit('solarion', 0, 40, 40);
  const teammate = world2.spawnUnit('knight', 2, 43, 40);
  const foe = world2.spawnUnit('knight', 1, 45, 40);
  stepWorld(world2);
  assert.ok(teammate.aura, '팀원 유닛도 오라를 받는다');
  assert.equal(foe.aura, null);
});

test('한 명이 져도 팀원이 남아 있으면 경기가 이어지고, 진 사람의 기지는 무너진다', () => {
  const world = newWorld();
  command(world, 1, { type: CMD.SURRENDER });
  assert.equal(world.players[1].defeated, true);
  assert.equal(world.result, null, '팀원(D)이 남아 있다');
  stepWorld(world);
  assert.equal([...world.units.values(), ...world.buildings.values()].some((e) => e.owner === 1), false, '항복한 사람의 유닛·건물은 사라진다');
  assert.ok([...world.buildings.values()].some((b) => b.owner === 3), '팀원의 기지는 그대로다');

  command(world, 3, { type: CMD.SURRENDER });
  assert.deepEqual({ ...world.result, tick: undefined }, { winnerTeam: 0, reason: VICTORY_REASON.SURRENDER, tick: undefined });
});
