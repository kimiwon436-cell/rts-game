// 세 맹세와 궁극 유닛 — docs/GAME_DESIGN.md 4장
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { ABILITIES, GARRISON } from '@rune/shared/data/abilities.js';
import { CMD, REJECT, GAME_EVENT } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];

let seq = 0;
/** 궁극 유닛의 규칙만 보려고 지형을 모두 풀밭으로 편 맵 (본진·금광·샘 자리는 그대로). 강·바다 배치와 상관없이 늘 같은 들판이다 */
const FLAT_MAP = (() => {
  const map = loadMap('duel01');
  return { ...map, tiles: new Uint8Array(map.tiles.length) };
})();
const newWorld = () => new World(FLAT_MAP, PLAYERS);
const command = (world, slot, cmd) =>
  stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]).rejects[0]?.reason ?? null;

/** 적을 찾는 주기가 4틱이라, 한 대씩 주고받게 하려면 몇 틱 돌려야 한다 */
function runTicks(world, ticks) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepWorld(world).events);
  return events;
}

function runSeconds(world, seconds) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) events.push(...stepWorld(world).events);
  return events;
}

/** 빈 들판에 궁극 유닛을 세운다 (맹세를 맺은 것으로 치고) */
function setupUltimate(world, slot, type, x, y) {
  const oath = { solarion: 'crown', etheria: 'rune', arkanon: 'earth' }[type];
  world.players[slot].oath = oath;
  return world.spawnUnit(type, slot, x, y);
}

const hpOf = (unit) => Math.round(unit.hp * 100) / 100;

test('성소가 완성돼야 맹세를 맺고, 한 번 맺으면 바꿀 수 없다', () => {
  const world = newWorld();
  assert.equal(command(world, 0, { type: CMD.TAKE_OATH, oath: 'crown' }), REJECT.REQUIRES_BUILDING);
  assert.equal(command(world, 0, { type: CMD.TAKE_OATH, oath: '없는맹세' }), REJECT.INVALID);

  world.spawnBuilding('sanctum', 0, 20, 70, { complete: true });
  const events = stepWorld(world, [{ slot: 0, cmd: { seq: ++seq, type: CMD.TAKE_OATH, oath: 'rune' } }]).events;
  assert.equal(world.players[0].oath, 'rune');
  assert.ok(events.some((e) => e[0] === GAME_EVENT.OATH_TAKEN && e[1] === 0), '전역 공지 이벤트가 나간다');

  assert.equal(command(world, 0, { type: CMD.TAKE_OATH, oath: 'crown' }), REJECT.OATH_ALREADY_TAKEN);
});

test('맺은 맹세의 궁극 유닛만, 한 경기에 한 기만 뽑는다', () => {
  const world = newWorld();
  const player = world.players[0];
  Object.assign(player, { gold: 3000, wood: 3000, mana: 3000, age: 3, oath: 'crown' });
  const sanctum = world.spawnBuilding('sanctum', 0, 20, 70, { complete: true });

  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: sanctum.id, unit: 'etheria' }), REJECT.REQUIRES_OATH);
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: sanctum.id, unit: 'solarion' }), null);
  assert.deepEqual([player.gold, player.wood, player.mana], [2200, 2700, 2600]);
  // 대기열에 이미 있으면 두 기째는 안 된다
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: sanctum.id, unit: 'solarion' }), REJECT.ULTIMATE_EXISTS);

  world.spawnUnit('solarion', 0, 30, 70);
  sanctum.queue = [];
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: sanctum.id, unit: 'solarion' }), REJECT.ULTIMATE_EXISTS);
});

test('새벽의 오라: 주변 아군은 20% 더 때리고 15% 덜 맞는다', () => {
  // 오라 없이: 기사 한 대, 근위병 한 대
  const plain = newWorld();
  const knight = plain.spawnUnit('knight', 0, 40, 40);
  const enemy = plain.spawnUnit('royal_guard', 1, 40.8, 40);
  runTicks(plain, 4);
  const dealt = 240 - hpOf(enemy);
  const taken = 260 - hpOf(knight);

  // 솔라리온을 4타일 옆에 세우면 같은 교전이 달라진다
  const aura = newWorld();
  const knight2 = aura.spawnUnit('knight', 0, 40, 40);
  const enemy2 = aura.spawnUnit('royal_guard', 1, 40.8, 40);
  const solarion = setupUltimate(aura, 0, 'solarion', 44, 40);
  const far = aura.spawnUnit('knight', 0, 60, 60);
  runTicks(aura, 4);
  const dealtWithAura = 240 - hpOf(enemy2);
  const takenWithAura = 260 - hpOf(knight2);

  assert.ok(dealt > 0 && taken > 0, '오라 없이도 한 대씩 주고받았다');
  assert.ok(Math.abs(dealtWithAura / dealt - 1.2) < 0.01, `주는 피해 배율 ${dealtWithAura / dealt}`);
  assert.ok(Math.abs(takenWithAura / taken - 0.85) < 0.01, `받는 피해 배율 ${takenWithAura / taken}`);
  assert.ok(knight2.aura, '가까운 아군은 오라를 받는다');
  assert.equal(far.aura, null, '멀리 있는 아군은 오라를 못 받는다');
  assert.equal(solarion.aura, null, '자기 자신은 오라를 받지 않는다');
});

test('거인 사냥꾼: 솔라리온은 거대 유닛을 3배로 때린다', () => {
  const world = newWorld();
  const solarion = setupUltimate(world, 0, 'solarion', 40, 40);
  const arkanon = setupUltimate(world, 1, 'arkanon', 41.4, 40);
  runTicks(world, 4);

  // 60 × 거대 0.6 × 3 = 108 (아르카논은 뿌리내리지 않아 감소 없음)
  assert.equal(Math.round(5000 - arkanon.hp), 108);
  assert.ok(solarion.hp < 1800, '아르카논도 반격한다');
});

test('여명 돌격: 8타일 돌진하며 지나간 적을 때리고 기절시킨다', () => {
  const world = newWorld();
  const solarion = setupUltimate(world, 0, 'solarion', 40, 40);
  const onPath = world.spawnUnit('royal_guard', 1, 44, 40); // 돌진 경로 위
  const aside = world.spawnUnit('royal_guard', 1, 44, 43); // 옆으로 비껴 있음

  assert.equal(
    command(world, 0, { type: CMD.USE_ABILITY, unitIds: [solarion.id], ability: 'dawnCharge', x: 52, y: 40 }),
    null,
  );
  assert.ok(solarion.x > 47.5, `8타일 돌진했다 (x=${solarion.x})`);
  assert.equal(Math.round(240 - onPath.hp), 96, '경로 위의 적은 120 × 중갑 0.8 = 96을 맞는다');
  assert.equal(aside.hp, 240, '비껴 있는 적은 멀쩡하다');
  assert.equal(onPath.stunned, true, '기절했다');

  // 기절한 동안은 움직이지 못한다
  const startX = onPath.x;
  assert.equal(command(world, 1, { type: CMD.MOVE, unitIds: [onPath.id], x: 20, y: 40 }), null);
  runSeconds(world, 1);
  assert.equal(Math.round(onPath.x * 100) / 100, startX, '기절 중에는 제자리');

  runSeconds(world, 1.5);
  assert.equal(onPath.stunned, false);
  assert.ok(onPath.x < startX - 0.5, `풀리면 다시 움직인다 (x=${onPath.x})`);

  // 재사용 대기
  assert.equal(
    command(world, 0, { type: CMD.USE_ABILITY, unitIds: [solarion.id], ability: 'dawnCharge', x: 60, y: 40 }),
    REJECT.ON_COOLDOWN,
  );
});

test('연쇄 번개: 에테리아의 공격이 3기까지 튕기며 약해진다', () => {
  const world = newWorld();
  const etheria = setupUltimate(world, 0, 'etheria', 40, 40);
  const a = world.spawnUnit('pikeman', 1, 44, 40);
  const b = world.spawnUnit('pikeman', 1, 45.5, 40);
  const c = world.spawnUnit('pikeman', 1, 47, 40);
  const d = world.spawnUnit('pikeman', 1, 48.5, 40);

  runTicks(world, 4);
  const damage = [a, b, c, d].map((u) => Math.round((110 - u.hp) * 100) / 100);
  assert.ok(damage[0] > 0 && damage[1] > 0 && damage[2] > 0, '세 기까지 맞는다');
  assert.equal(damage[3], 0, '네 번째는 안 맞는다');
  assert.ok(Math.abs(damage[1] / damage[0] - 0.75) < 0.01, `두 번째는 25% 약하다 (${damage[1] / damage[0]})`);
  assert.ok(Math.abs(damage[2] / damage[0] - 0.5625) < 0.01, `세 번째는 또 25% 약하다 (${damage[2] / damage[0]})`);
});

test('성좌 붕괴: 2.5초 영창 뒤 반경 4타일을 태우고, 움직이면 취소된다', () => {
  const world = newWorld();
  const etheria = setupUltimate(world, 0, 'etheria', 40, 40);
  const victim = world.spawnUnit('knight', 1, 45, 40);

  assert.equal(command(world, 0, { type: CMD.USE_ABILITY, unitIds: [etheria.id], ability: 'starfall', x: 45, y: 40 }), null);
  assert.ok(etheria.channel, '영창 시작');
  assert.equal(etheria.channeling, true);
  runSeconds(world, 2.4);
  assert.equal(victim.hp, 260, '아직 터지지 않았다');

  runSeconds(world, 0.3);
  // 350 × 마법 vs 중갑 1.5 = 525
  assert.ok(victim.hp <= 0, `영창이 끝나면 터진다 (hp=${victim.hp})`);
  assert.equal(etheria.channel, null);

  // 움직이면 취소된다
  const world2 = newWorld();
  const mage = setupUltimate(world2, 0, 'etheria', 40, 40);
  const target = world2.spawnUnit('knight', 1, 60, 60);
  command(world2, 0, { type: CMD.USE_ABILITY, unitIds: [mage.id], ability: 'starfall', x: 44, y: 40 });
  command(world2, 0, { type: CMD.MOVE, unitIds: [mage.id], x: 30, y: 40 });
  runSeconds(world2, 3);
  assert.equal(mage.channel, null, '이동하면 영창이 끊긴다');
  assert.equal(target.hp, 260);
});

test('시간의 결계: 적이 느려지고, 마나 공명이 대기시간을 줄인다', () => {
  const world = newWorld();
  const etheria = setupUltimate(world, 0, 'etheria', 40, 40);
  const enemy = world.spawnUnit('knight', 1, 43, 40);

  assert.equal(command(world, 0, { type: CMD.USE_ABILITY, unitIds: [etheria.id], ability: 'timeWard', x: 43, y: 40 }), null);
  assert.equal(enemy.slowed, true);
  const ready = etheria.cooldowns.timeWard - world.tick;
  assert.ok(Math.abs(ready - 600) <= 2, `오벨리스크 없이 30초 (${ready}틱)`);

  // 느려진 기사는 같은 시간에 60%만 간다
  command(world, 1, { type: CMD.MOVE, unitIds: [enemy.id], x: 43, y: 60 });
  const before = enemy.y;
  runSeconds(world, 1);
  const moved = enemy.y - before;
  assert.ok(Math.abs(moved - 3.6 * 0.6) < 0.25, `둔화 이동 거리 ${moved}`);

  // 마나 공명: 오벨리스크 4개면 대기시간 40% 감소 (30초 → 18초)
  const world2 = newWorld();
  const mage = setupUltimate(world2, 0, 'etheria', 40, 40);
  world2.map.wells.slice(0, 4).forEach((well, i) => {
    const b = world2.spawnBuilding('obelisk', 0, 4 + i * 3, 4, { complete: true });
    b.wellId = well.id;
  });
  command(world2, 0, { type: CMD.USE_ABILITY, unitIds: [mage.id], ability: 'timeWard', x: 41, y: 40 });
  const reduced = mage.cooldowns.timeWard - world2.tick;
  assert.ok(Math.abs(reduced - 360) <= 2, `오벨리스크 4개면 18초 (${reduced}틱)`);
});

test('등 위의 성채: 6기까지 태우고, 탄 유닛은 맞지 않으며 등 위에서 사거리가 늘어난다', () => {
  const world = newWorld();
  const arkanon = setupUltimate(world, 0, 'arkanon', 40, 40);
  const riders = Array.from({ length: 7 }, (_, i) => world.spawnUnit('longbowman', 0, 41 + i * 0.4, 41));
  const knight = world.spawnUnit('knight', 0, 44, 44); // 기사는 탈 수 없다

  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: [knight.id], targetId: arkanon.id }), REJECT.CANNOT_BOARD);
  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: riders.map((u) => u.id), targetId: arkanon.id }), null);
  runSeconds(world, 3);

  assert.equal(arkanon.garrison.length, GARRISON.capacity, '정원은 6기');
  assert.equal(arkanon.extra, GARRISON.capacity, '스냅샷에 탑승 인원이 실린다');
  const [aboard] = arkanon.garrison.map((id) => world.units.get(id));
  assert.equal(aboard.carrierId, arkanon.id);
  assert.equal(aboard.x, arkanon.x, '등 위에서는 태운 쪽을 따라다닌다');

  // 탄 유닛은 맞지 않는다: 적 기사가 달려들어도 아르카논만 아프다
  world.spawnUnit('knight', 1, 41.4, 40);
  runSeconds(world, 2);
  assert.equal(aboard.hp, 70, '등에 탄 유닛은 피해를 받지 않는다');
  assert.ok(arkanon.hp < 5000, '아르카논이 대신 맞는다');

  // 등 위의 장궁병은 사거리 6 + 2로 먼 적을 쏜다
  const world2 = newWorld();
  const turtle = setupUltimate(world2, 0, 'arkanon', 40, 40);
  const archer = world2.spawnUnit('longbowman', 0, 40.5, 40);
  world2.boardUnit(turtle, archer);
  const farEnemy = world2.spawnUnit('pikeman', 1, 47.3, 40); // 몸 사이 약 7타일
  runSeconds(world2, 1);
  assert.ok(farEnemy.hp < 110, `등 위에서 사거리가 늘어난다 (hp=${farEnemy.hp})`);

  // 내리면 밖으로 나온다
  assert.equal(command(world2, 0, { type: CMD.USE_ABILITY, unitIds: [turtle.id], ability: 'unload' }), null);
  assert.equal(turtle.garrison.length, 0);
  assert.equal(archer.carrierId, null);
  assert.ok(Math.hypot(archer.x - turtle.x, archer.y - turtle.y) > 0.4, '등 옆에 내려놓는다');
});

test('아르카논이 쓰러져도 등에 탄 유닛은 살아 나온다', () => {
  const world = newWorld();
  const arkanon = setupUltimate(world, 0, 'arkanon', 40, 40);
  const rider = world.spawnUnit('pikeman', 0, 40.5, 40);
  world.boardUnit(arkanon, rider);

  arkanon.hp = 1;
  world.spawnUnit('knight', 1, 41, 40);
  runSeconds(world, 2);

  assert.equal(world.units.has(arkanon.id), false, '아르카논은 쓰러졌다');
  assert.equal(world.units.has(rider.id), true, '탔던 유닛은 살아 있다');
  assert.equal(rider.carrierId, null);
});

test('뿌리내리기: 못 움직이고 덜 맞고 인구가 늘고 병력을 뽑는다. 해제에 5초', () => {
  const world = newWorld();
  const player = world.players[0];
  Object.assign(player, { gold: 1000, wood: 1000 });
  const arkanon = setupUltimate(world, 0, 'arkanon', 40, 40);
  const popCapBefore = player.popCap;

  assert.equal(command(world, 0, { type: CMD.TOGGLE_ABILITY, unitIds: [arkanon.id], ability: 'root' }), null);
  assert.equal(arkanon.rooted, true, '뿌리내리기는 즉시');
  assert.equal(player.popCap - popCapBefore, ABILITIES.root.popCap, '인구 상한 +10');

  // 못 움직인다
  command(world, 0, { type: CMD.MOVE, unitIds: [arkanon.id], x: 30, y: 40 });
  runSeconds(world, 2);
  assert.equal(Math.round(arkanon.x), 40, '뿌리내린 채로는 움직이지 않는다');

  // 받는 피해 30% 감소: 창병 9 × 거대 0.6 = 5.4 → 3.78
  const pikeman = world.spawnUnit('pikeman', 1, 41, 40);
  const before = arkanon.hp;
  runTicks(world, 4);
  const taken = Math.round((before - arkanon.hp) * 100) / 100;
  assert.ok(Math.abs(taken - 5.4 * 0.7) < 0.01, `받는 피해 ${taken}`);
  world.units.delete(pikeman.id);

  // 창병·장궁병을 뽑는다
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: arkanon.id, unit: 'knight' }), REJECT.INVALID);
  assert.equal(command(world, 0, { type: CMD.TRAIN, buildingId: arkanon.id, unit: 'pikeman' }), null);
  assert.equal(arkanon.queue.length, 1);
  runSeconds(world, 19);
  assert.equal(arkanon.queue.length, 0, '생산이 끝났다');
  assert.ok([...world.units.values()].some((u) => u.owner === 0 && u.type === 'pikeman'), '전선에서 창병이 나온다');

  // 해제는 5초 걸린다
  assert.equal(command(world, 0, { type: CMD.TOGGLE_ABILITY, unitIds: [arkanon.id], ability: 'root' }), null);
  assert.equal(arkanon.rooting, true);
  runSeconds(world, 4);
  assert.equal(arkanon.rooted, true, '아직 뽑는 중');
  runSeconds(world, 1.2);
  assert.equal(arkanon.rooted, false, '5초 뒤에 풀린다');
  assert.equal(player.popCap, popCapBefore, '인구 상한도 돌아온다');
});

test('불멸의 맹세: 솔라리온은 60초 뒤 금 300을 치르고 영주관에서 부활한다', () => {
  const world = newWorld();
  const player = world.players[0];
  player.gold = 0;
  const solarion = setupUltimate(world, 0, 'solarion', 40, 40);
  solarion.hp = 1;
  world.spawnUnit('knight', 1, 41, 40);

  const events = runSeconds(world, 3);
  assert.equal(world.units.has(solarion.id), false, '쓰러졌다');
  assert.ok(events.some((e) => e[0] === GAME_EVENT.ULTIMATE_LOST && e[1] === 0));
  assert.ok(player.revive, '부활이 예약된다');

  runSeconds(world, 58);
  assert.equal(player.revive !== null, true, '60초는 지나야 한다');
  const alive = () => [...world.units.values()].some((u) => u.type === 'solarion' && u.owner === 0);
  assert.equal(alive(), false);

  runSeconds(world, 3);
  assert.equal(alive(), false, '금이 없으면 때를 기다린다');

  player.gold = 300;
  const revived = runSeconds(world, 0.5);
  assert.equal(alive(), true, '금이 모이면 영주관 옆에서 일어선다');
  assert.equal(Math.floor(player.gold), 0, '부활 비용 300을 낸다');
  assert.ok(revived.some((e) => e[0] === GAME_EVENT.ULTIMATE_REVIVED));
  assert.equal(player.revive, null);
});

test('등에 탄 유닛은 명령을 받지 않고, 다시 태우라고 해도 상태가 꼬이지 않는다', () => {
  const world = newWorld();
  const arkanon = setupUltimate(world, 0, 'arkanon', 40, 40);
  const archer = world.spawnUnit('longbowman', 0, 40.5, 40);
  world.boardUnit(arkanon, archer);
  stepWorld(world);

  // 탄 채로 이동·태우기 명령을 받아도 무시된다
  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: [archer.id], x: 20, y: 20 }), REJECT.INVALID_TARGET);
  assert.equal(command(world, 0, { type: CMD.BOARD, unitIds: [archer.id], targetId: arkanon.id }), REJECT.INVALID_TARGET);
  runSeconds(world, 1);
  assert.equal(archer.carrierId, arkanon.id);
  assert.equal(archer.order, null);
  assert.equal(archer.x, arkanon.x);
});
