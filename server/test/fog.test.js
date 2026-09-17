// 전장의 안개: 팀마다 보이는 것만 보내고, 보이는 적만 노린다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { REVEAL_SECONDS } from '@rune/shared/rules/vision.js';
import { CMD, GAME_EVENT, REJECT } from '@rune/shared/protocol.js';
import { POS_SCALE } from '@rune/shared/snapshot.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';
import { SnapshotFeed } from '../src/game/sync/snapshot.js';

const DUEL = [
  { uid: 'a', nickname: 'A', slot: 0 },
  { uid: 'b', nickname: 'B', slot: 1 },
];

/** 서버 한 판: step()마다 모든 플레이어의 스냅샷을 inbox[slot]에 쌓는다 */
function setup(mapId = 'duel01', players = DUEL) {
  const world = new World(loadMap(mapId), players);
  const feed = new SnapshotFeed(world);
  const inbox = players.map(() => []);
  let seq = 0;
  const step = (commands = []) => {
    const { rejects, events } = stepWorld(world, commands);
    feed.update(world, events);
    for (const p of players) inbox[p.slot].push(feed.snapshotFor(world, p.slot));
    return { rejects, events };
  };
  const command = (slot, cmd) => step([{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]).rejects[0]?.reason ?? null;
  const run = (seconds) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) step();
  };
  step();
  return { world, feed, inbox, step, command, run };
}

/** 스냅샷을 이어 받은 클라이언트가 아는 유닛·건물 id */
function known(snaps, addKey) {
  const ids = new Set();
  for (const snap of snaps) {
    for (const encoded of snap[addKey] ?? []) ids.add(encoded[0]);
    for (const id of snap.del ?? []) ids.delete(id);
  }
  return ids;
}
const knownUnits = (snaps) => known(snaps, 'addU');
const knownBuildings = (snaps) => known(snaps, 'addB');
const eventsOf = (snaps, code) => snaps.flatMap((snap) => snap.ev ?? []).filter((event) => event[0] === code);

/** 두 팀 모두 못 보는 탁 트인 빈 땅의 왼쪽 위 (w × h) */
function hiddenField(world, w, h) {
  for (let y = 4; y < world.height - h - 4; y++) {
    for (let x = 4; x < world.width - w - 4; x++) {
      let ok = true;
      for (let ty = y - 1; ty <= y + h && ok; ty++) {
        for (let tx = x - 1; tx <= x + w && ok; tx++) {
          if (world.nav.isBlocked(tx, ty) || world.occupied[ty * world.width + tx]) ok = false;
          else if (world.vision.isVisible(0, tx, ty) || world.vision.isVisible(1, tx, ty)) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('빈 땅을 찾지 못했다');
}

test('적 유닛은 우리 팀에게 보일 때만 오고, 안개 속으로 들어가면 지워진다', () => {
  const { world, inbox, step } = setup();
  const field = hiddenField(world, 24, 3);
  const eye = world.spawnUnit('peasant', 0, field.x + 0.5, field.y + 1.5); // 시야 6
  const enemy = world.spawnUnit('peasant', 1, field.x + 20.5, field.y + 1.5);
  step();
  step();
  assert.ok(knownUnits(inbox[0]).has(eye.id));
  assert.equal(knownUnits(inbox[0]).has(enemy.id), false, '20칸 떨어진 적은 오지 않는다');
  assert.equal(knownUnits(inbox[1]).has(eye.id), false);
  assert.equal(inbox[0].length, inbox[1].length);

  enemy.x = field.x + 5.5; // 시야 안으로
  step();
  step();
  assert.ok(knownUnits(inbox[0]).has(enemy.id), '보이면 온다');
  assert.ok(knownUnits(inbox[1]).has(eye.id), '상대도 우리를 본다');

  enemy.x = field.x + 20.5; // 다시 안개 속으로
  step();
  step();
  const after = inbox[0].length;
  assert.equal(knownUnits(inbox[0]).has(enemy.id), false, '안개 속으로 들어가면 지워진다');
  enemy.x = field.x + 21.5; // 안개 속에서 움직여도
  enemy.hp = 30;
  step();
  step();
  const leaked = inbox[0].slice(after).flatMap((snap) => snap.updU ?? []).filter((delta) => delta[0] === enemy.id);
  assert.deepEqual(leaked, [], '안개 속 적의 움직임·체력은 오지 않는다');
});

test('적 건물은 한 번 보면 본 모습 그대로 기억하고, 안개 속에서 무너지면 다시 볼 때 지워진다', () => {
  const { world, feed, inbox, step, command } = setup();
  const field = hiddenField(world, 30, 4);
  const barracks = world.spawnBuilding('barracks', 1, field.x + 22, field.y, { complete: true });
  const eye = world.spawnUnit('peasant', 0, field.x + 0.5, field.y + 1.5);
  const knight = world.spawnUnit('knight', 0, field.x + 1.5, field.y + 3.5);
  step();
  assert.equal(knownBuildings(inbox[0]).has(barracks.id), false, '본 적 없는 건물은 오지 않는다');
  assert.equal(command(0, { type: CMD.ATTACK, unitIds: [knight.id], targetId: barracks.id }), REJECT.INVALID_TARGET, '모르는 건물은 노릴 수 없다');

  eye.x = field.x + 17.5; // 병영 가장자리에서 4.5칸
  step();
  step();
  assert.ok(knownBuildings(inbox[0]).has(barracks.id), '보면 온다');

  eye.x = field.x + 0.5; // 떠난다
  step();
  step();
  const left = inbox[0].length;
  barracks.hp -= 300;
  step();
  assert.ok(knownBuildings(inbox[0]).has(barracks.id), '안개 속 건물은 지우지 않는다');
  assert.deepEqual(inbox[0].slice(left).flatMap((snap) => snap.updB ?? []), [], '안개 속에서 깎인 체력은 모른다');
  const ghost = feed.full(world, 0).addB.find((encoded) => encoded[0] === barracks.id);
  assert.equal(ghost[5], 1000, '다시 접속해도 마지막으로 본 체력');
  assert.equal(feed.full(world, 1).addB.find((encoded) => encoded[0] === barracks.id)[5], 700, '주인은 실제 체력');
  assert.equal(command(0, { type: CMD.ATTACK, unitIds: [knight.id], targetId: barracks.id }), null, '본 적 있는 건물은 안개 속이어도 공격하러 간다');

  barracks.hp = 0; // 안개 속에서 무너진다
  step();
  step();
  assert.ok(knownBuildings(inbox[0]).has(barracks.id), '무너진 줄 모른다');
  assert.equal(eventsOf(inbox[0], GAME_EVENT.BUILDING_DESTROYED).length, 0);

  eye.x = field.x + 17.5; // 그 자리를 다시 본다
  step();
  step();
  assert.equal(knownBuildings(inbox[0]).has(barracks.id), false, '다시 보면 지워진다');
  assert.equal(eventsOf(inbox[0], GAME_EVENT.BUILDING_DESTROYED).length, 0, '무너지는 모습은 못 봤다');
  assert.equal(eventsOf(inbox[1], GAME_EVENT.BUILDING_DESTROYED).length, 1);
});

test('안개 속에서 베인 나무와 줄어든 금광은 그 자리를 볼 때 알린다', () => {
  const { world, feed, inbox, step } = setup();
  const tree = world.tiles.findIndex((t, i) => t === TERRAIN.TREE && !world.vision.isTileVisible(0, i));
  const mine = world.map.goldMines.find((m) => !world.vision.isRectVisible(0, m));
  const before = world.mines.get(mine.id).amount;
  world.fellTree(tree);
  world.mines.get(mine.id).amount -= 100;
  const from = inbox[0].length;
  step();
  step();

  assert.equal(eventsOf(inbox[0].slice(from), GAME_EVENT.TREE_FELLED).length, 0, '안 보이는 나무');
  assert.deepEqual(inbox[0].slice(from).flatMap((snap) => snap.mines ?? []), [], '안 보이는 금광');
  const full = feed.full(world, 0);
  assert.equal(full.felled.includes(tree), false);
  assert.deepEqual(full.mines.find(([id]) => id === mine.id), [mine.id, before], '마지막으로 본 양');

  const tx = tree % world.width;
  const ty = Math.floor(tree / world.width);
  const [ex, ey] = world.nearestFreeTile(tx + 0.5, ty + 0.5);
  world.spawnUnit('scout_rider', 0, ex + 0.5, ey + 0.5);
  const [mx, my] = world.nearestFreeTile(mine.x + mine.w + 0.5, mine.y + 0.5);
  world.spawnUnit('scout_rider', 0, mx + 0.5, my + 0.5);
  step();
  step();
  assert.deepEqual(eventsOf(inbox[0].slice(from), GAME_EVENT.TREE_FELLED), [[GAME_EVENT.TREE_FELLED, tree]], '보면 알린다');
  assert.deepEqual(inbox[0].slice(from).flatMap((snap) => snap.mines ?? []), [[mine.id, before - 100]]);
  assert.ok(feed.full(world, 0).felled.includes(tree));
});

test('상대 진영 안쪽의 일(생산·능력)은 보일 때만 알리고, 시대·맹세 같은 공지는 모두에게 간다', () => {
  const { world, feed } = setup();
  const keep1 = [...world.buildings.values()].find((b) => b.owner === 1);
  const unit = world.spawnUnitNear('pikeman', 1, keep1, keep1);
  stepWorld(world);
  const x16 = Math.round(unit.x * POS_SCALE);
  const y16 = Math.round(unit.y * POS_SCALE);
  feed.update(world, [
    [GAME_EVENT.TRAINED, unit.id, 1],
    [GAME_EVENT.ABILITY, unit.id, 2, x16, y16, 0],
    [GAME_EVENT.AGE_UP, 1, 2],
    [GAME_EVENT.OATH_TAKEN, 1, 0],
  ]);
  const codes = (slot) => (feed.snapshotFor(world, slot).ev ?? []).map((event) => event[0]);
  assert.deepEqual(codes(0), [GAME_EVENT.AGE_UP, GAME_EVENT.OATH_TAKEN]);
  assert.deepEqual(codes(1), [GAME_EVENT.TRAINED, GAME_EVENT.ABILITY, GAME_EVENT.AGE_UP, GAME_EVENT.OATH_TAKEN]);
});

test('안 보이는 적 유닛은 공격 명령으로 노릴 수 없고, 스스로도 노리지 않는다', () => {
  const { world, command, run } = setup();
  const field = hiddenField(world, 24, 3);
  // 장궁병은 몸 사이 8칸까지 스스로 노리지만 시야는 8칸(칸 중심 기준)이다: 그 사이에 선 적
  const bow = world.spawnUnit('longbowman', 0, field.x + 0.5, field.y + 1.5);
  const far = world.spawnUnit('peasant', 1, field.x + 9.0, field.y + 1.5); // 몸 사이 7.9, 9번째 칸
  assert.equal(command(0, { type: CMD.ATTACK, unitIds: [bow.id], targetId: far.id }), REJECT.INVALID_TARGET);
  run(3);
  assert.equal(far.hp, 60, '보이지 않으면 쏘지 않는다 (안개가 없었다면 쐈을 거리)');

  world.spawnUnit('peasant', 0, field.x + 4.5, field.y + 2.5); // 싸우지 않는 농노가 비춰 주면
  run(3);
  assert.ok(far.hp < 60, '팀의 시야에 들면 쏜다');
});

test('보이지 않는 곳에서 공격한 적은 맞은 팀에게 잠깐 드러난다', () => {
  const { world, inbox, step, run } = setup();
  const field = hiddenField(world, 16, 4);
  const tower = world.spawnBuilding('watchtower', 1, field.x, field.y, { complete: true }); // 사거리 7
  const victim = world.spawnUnit('peasant', 0, field.x + 8.5, field.y + 1.5); // 감시탑 가장자리에서 6.5, 농노 시야 6
  step();
  assert.equal(world.isVisibleTo(0, tower), false, '쏘기 전에는 안 보인다');

  for (let i = 0; i < 80 && victim.hp === 60; i++) step();
  assert.ok(victim.hp < 60, '감시탑이 쏜다');
  step();
  assert.equal(world.isVisibleTo(0, tower), true, '쏜 감시탑이 드러난다');
  assert.ok(knownBuildings(inbox[0]).has(tower.id));

  world.units.delete(victim.id); // 과녁이 사라지면 더 쏘지 않는다
  run(REVEAL_SECONDS + 0.2);
  assert.equal(world.isVisibleTo(0, tower), false, `${REVEAL_SECONDS}초 뒤에는 다시 안개 속`);
});

test('쫓던 적이 안개 속으로 사라지면 마지막으로 본 곳까지 공격 이동으로 간다', () => {
  const { world, step, command } = setup();
  const field = hiddenField(world, 30, 3);
  const pike = world.spawnUnit('pikeman', 0, field.x + 0.5, field.y + 1.5);
  const target = world.spawnUnit('peasant', 1, field.x + 5.5, field.y + 1.5);
  step();
  assert.equal(command(0, { type: CMD.ATTACK, unitIds: [pike.id], targetId: target.id }), null);
  const seen = { x: target.x, y: target.y };
  target.x = field.x + 28.5; // 순식간에 멀어졌다
  step();
  step();
  assert.equal(pike.order?.type, 'attackMove');
  const { point } = pike.order.goal;
  assert.ok(Math.hypot(point.x - seen.x, point.y - seen.y) < 0.01, '마지막으로 본 자리로 간다 (지금 자리가 아니라)');
});

test('팀전: 팀원이 본 적은 나에게도 보인다', () => {
  const players = [
    { uid: 'a', nickname: 'A', slot: 0, team: 0 },
    { uid: 'b', nickname: 'B', slot: 1, team: 1 },
    { uid: 'c', nickname: 'C', slot: 2, team: 0 },
    { uid: 'd', nickname: 'D', slot: 3, team: 1 },
  ];
  const { world, inbox, step } = setup('team01', players);
  const field = hiddenField(world, 12, 3);
  world.spawnUnit('peasant', 2, field.x + 0.5, field.y + 1.5); // 팀원 C의 눈
  const enemy = world.spawnUnit('peasant', 3, field.x + 4.5, field.y + 1.5);
  step();
  step();
  assert.ok(knownUnits(inbox[0]).has(enemy.id), 'A도 C가 본 적을 받는다');
  assert.equal(knownUnits(inbox[1]).has(enemy.id), true, 'B는 팀원 D의 유닛이라 늘 안다');
});
