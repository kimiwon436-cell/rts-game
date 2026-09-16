import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { CMD, UNIT_STATE } from '@rune/shared/protocol.js';
import { World } from '../src/game/World.js';
import { TICK_SECONDS, stepWorld } from '../src/game/Simulation.js';
import { PATH_BUDGET } from '../src/game/systems/movement.js';
import { assignSlots } from '../src/game/systems/commands.js';

const PLAYERS = [
  { uid: 'p1', nickname: 'P1', slot: 0 },
  { uid: 'p2', nickname: 'P2', slot: 1 },
];
const newWorld = () => new World(loadMap('duel01'), PLAYERS);
const keepOf = (world, slot) => [...world.buildings.values()].find((b) => b.owner === slot && b.type === 'keep');

let seq = 0;
function command(world, slot, cmd) {
  const { rejects } = stepWorld(world, [{ slot, cmd: { seq: ++seq, unitIds: [], ...cmd } }]);
  return rejects[0]?.reason ?? null;
}

function runSeconds(world, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) stepWorld(world);
}

/** P1 본진 앞 풀밭의 빈 칸 중심 */
function openPoint(world) {
  const [tx, ty] = world.nearestFreeTile(36.5, 66.5);
  return { x: tx + 0.5, y: ty + 0.5 };
}

test('모여 있는 무리는 대형을 유지한 채 서로 다른 칸을 받는다', () => {
  const units = [
    { id: 1, x: 10.5, y: 10.5 },
    { id: 2, x: 11.5, y: 10.5 },
  ];
  const slots = [[30, 10], [31, 10], [29, 10], [30, 11]];
  const bySlot = new Map(assignSlots(units, slots, 30.5, 10.5).map(([u, s]) => [u.id, s]));
  assert.notDeepEqual(bySlot.get(1), bySlot.get(2));
  assert.ok(bySlot.get(1)[0] < bySlot.get(2)[0], '왼쪽에 있던 유닛이 왼쪽 칸을 받아야 한다');
});

test('무리 이동: 12기가 목표 주변의 서로 다른 자리에 멈추고 막힌 칸에 들어가지 않는다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);
  const army = Array.from({ length: 12 }, () => world.spawnUnitNear('pikeman', 0, keep, { x: 48, y: 48 }));
  const target = openPoint(world);

  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: army.map((u) => u.id), ...target }), null);
  runSeconds(world, 20);

  for (const unit of army) {
    assert.equal(unit.state, UNIT_STATE.IDLE, `유닛 ${unit.id}이 멈추지 않았다`);
    assert.ok(!world.nav.isBlocked(Math.floor(unit.x), Math.floor(unit.y)), `유닛 ${unit.id}이 막힌 칸에 있다`);
    assert.ok(Math.hypot(unit.x - target.x, unit.y - target.y) < 4, `유닛 ${unit.id}이 목표에서 멀다`);
  }
  for (let i = 0; i < army.length; i++) {
    for (let j = i + 1; j < army.length; j++) {
      const d = Math.hypot(army[i].x - army[j].x, army[i].y - army[j].y);
      assert.ok(d >= 0.5, `유닛 ${army[i].id}와 ${army[j].id}가 겹쳐 있다 (${d.toFixed(2)})`);
    }
  }
});

test('경로 요청은 한 틱에 예산만큼만 계산하고 나머지는 다음 틱으로 넘긴다', () => {
  const world = newWorld();
  const keep = keepOf(world, 0);
  const army = Array.from({ length: PATH_BUDGET.count + 6 }, () =>
    world.spawnUnitNear('longbowman', 0, keep, { x: 48, y: 48 }),
  );

  assert.equal(command(world, 0, { type: CMD.MOVE, unitIds: army.map((u) => u.id), ...openPoint(world) }), null);
  assert.ok(army.filter((u) => u.pathPending).length >= 6, '예산보다 많은 요청이 한 틱에 처리됐다');

  runSeconds(world, 2);
  assert.equal(army.filter((u) => u.pathPending).length, 0, '남은 요청이 처리되지 않았다');
});

test('한자리에 겹친 유닛은 서로 밀려나 떨어진다', () => {
  const world = newWorld();
  const { x, y } = openPoint(world);
  const a = world.spawnUnit('pikeman', 0, x, y);
  const b = world.spawnUnit('pikeman', 0, x, y);

  runSeconds(world, 1);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 0.6);
  assert.ok(!world.nav.isBlocked(Math.floor(a.x), Math.floor(a.y)));
  assert.ok(!world.nav.isBlocked(Math.floor(b.x), Math.floor(b.y)));
});

test('같은 중간 지점을 동시에 지나가는 두 유닛이 서로 막혀 맴돌지 않는다', () => {
  // 예전에는 중간 웨이포인트에 중심이 정확히 닿아야 지나간 것으로 쳐서, 둘이 그 점을 두고 영원히 맴돌았다
  const world = newWorld();
  const keep = keepOf(world, 0);
  const wx = keep.x + keep.w + 3.5;
  const wy = keep.y + 2.5;
  const setPath = (unit, points) => {
    unit.order = { type: 'move' };
    unit.state = UNIT_STATE.MOVE;
    unit.path = points;
    unit.goal = { rect: { x: Math.floor(points[1][0]), y: Math.floor(points[1][1]), w: 1, h: 1 }, adjacent: false, point: null };
    unit.navVersion = world.nav.version;
  };
  const a = world.spawnUnit('pikeman', 0, wx - 2, wy);
  const b = world.spawnUnit('pikeman', 0, wx + 2, wy);
  setPath(a, [[wx, wy], [wx, wy + 4]]);
  setPath(b, [[wx, wy], [wx, wy - 4]]);

  runSeconds(world, 6);
  assert.equal(a.state, UNIT_STATE.IDLE, 'a가 도착해 멈췄다');
  assert.equal(b.state, UNIT_STATE.IDLE, 'b가 도착해 멈췄다');
  assert.ok(Math.hypot(a.x - wx, a.y - (wy + 4)) < 0.6, 'a는 제 목적지에 있다');
  assert.ok(Math.hypot(b.x - wx, b.y - (wy - 4)) < 0.6, 'b는 제 목적지에 있다');
});
