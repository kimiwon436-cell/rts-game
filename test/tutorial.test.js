// 튜토리얼을 처음부터 끝까지 "플레이어가 할 법한 명령"으로 진행해, 모든 단계를 실제로 끝낼 수 있는지 확인한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMD, EV } from '@rune/shared/protocol.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { LocalMatch } from '../src/tutorial/LocalMatch.js';
import { TUTORIAL_STEPS } from '../src/tutorial/steps.js';

const PLAYERS = [
  { uid: 'me', nickname: '나', slot: 0, team: 0 },
  { uid: 'tutor', nickname: '훈련 교관', slot: 1, team: 1 },
];

function setup() {
  const match = new LocalMatch({ mapId: 'duel01', players: PLAYERS, mySlot: 0 });
  const view = { camera: { x: 0, y: 0, zoomIndex: 2 }, selection: new Set() };
  return { match, ctx: { match, sim: match.world, view, slot: 0, touch: false, data: {} } };
}

let seq = 0;
const send = (match, cmd) => match.emit(EV.GAME_CMD, { seq: ++seq, ...cmd });
const peasants = (sim) => [...sim.units.values()].filter((u) => u.owner === 0 && u.type === 'peasant').sort((a, b) => a.id - b.id);
const keepOf = (sim) => [...sim.buildings.values()].find((b) => b.owner === 0 && b.type === 'keep');

function spotFor(sim, type, near) {
  for (let r = 3; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near.x + dx;
        const y = near.y + dy;
        const ok = checkPlacement({ type, x, y, map: sim.map, tiles: sim.tiles, occupied: sim.occupied, isWellTaken: (id) => sim.isWellTaken(id) });
        if (ok === PLACE.OK) return { x, y };
      }
    }
  }
  throw new Error(`${type} 자리를 찾지 못했다`);
}

/** 단계 목표를 이룰 때까지 틱을 돌린다 */
function runUntilDone(match, step, ctx, maxSeconds) {
  for (let i = 0; i < maxSeconds * 20; i++) {
    match.step();
    if (step.done(ctx)) return i;
  }
  assert.fail(`"${step.title}" 단계를 ${maxSeconds}초 안에 끝내지 못했다`);
}

test('튜토리얼의 모든 단계를 플레이어 명령만으로 끝낼 수 있다', () => {
  const { match, ctx } = setup();
  const { sim, view } = ctx;
  const actions = [
    // 화면 움직이기
    () => {
      view.camera.x += 300;
    },
    // 유닛 고르기
    () => view.selection.add(peasants(sim)[0].id),
    // 금 캐기
    () => {
      const mine = [...sim.mines.values()].sort((a, b) => Math.hypot(a.x - 14, a.y - 78) - Math.hypot(b.x - 14, b.y - 78))[0];
      send(match, { type: CMD.GATHER, unitIds: [peasants(sim)[0].id], mineId: mine.id });
    },
    // 여러 유닛 고르기
    () => peasants(sim).slice(1, 3).forEach((u) => view.selection.add(u.id)),
    // 나무 베기
    () => {
      const tree = sim.treesNear(16, 80, 30)[0];
      assert.equal(sim.tiles[tree], TERRAIN.TREE);
      send(match, { type: CMD.GATHER, unitIds: peasants(sim).slice(1, 3).map((u) => u.id), tile: tree });
    },
    // 농가 짓기
    () => {
      const keep = keepOf(sim);
      const spot = spotFor(sim, 'farmstead', { x: keep.x + 6, y: keep.y });
      send(match, { type: CMD.PLACE, unitIds: [peasants(sim)[3].id], building: 'farmstead', ...spot });
    },
    // 건설 기다리기
    () => {},
    // 병영 짓고 창병 뽑기
    () => {
      const keep = keepOf(sim);
      const spot = spotFor(sim, 'barracks', { x: keep.x, y: keep.y - 8 });
      send(match, { type: CMD.PLACE, unitIds: [peasants(sim)[3].id], building: 'barracks', ...spot });
      ctx.data.onTick = () => {
        const barracks = [...sim.buildings.values()].find((b) => b.owner === 0 && b.type === 'barracks' && b.complete);
        if (barracks && !ctx.data.trained) {
          ctx.data.trained = true;
          send(match, { type: CMD.TRAIN, buildingId: barracks.id, unit: 'pikeman' });
        }
      };
    },
    // 전투: 창병을 모두 골라 적을 공격
    () => {
      ctx.data.onTick = () => {
        const raider = ctx.data.raiders.map((id) => sim.units.get(id)).find(Boolean);
        const pikes = [...sim.units.values()].filter((u) => u.owner === 0 && u.type === 'pikeman' && !u.order);
        if (raider && pikes.length) send(match, { type: CMD.ATTACK, unitIds: pikes.map((u) => u.id), targetId: raider.id });
      };
    },
  ];

  const timeLimits = [1, 1, 1, 1, 1, 1, 90, 180, 60];
  TUTORIAL_STEPS.forEach((step, i) => {
    if (step.manual) return;
    ctx.data = {};
    step.start?.(ctx);
    actions[i]();
    const tick = ctx.data.onTick;
    if (tick) {
      const unsubscribe = match.onTick(tick);
      runUntilDone(match, step, ctx, timeLimits[i]);
      unsubscribe();
    } else {
      runUntilDone(match, step, ctx, timeLimits[i]);
    }
  });
  assert.equal(TUTORIAL_STEPS.at(-1).manual, true, '마지막 안내는 버튼으로 넘긴다');
  assert.equal(sim.result, null, '튜토리얼 경기는 끝나지 않는다');
});

test('기다리는 단계는 빨리 감고, 끝나면 원래 속도로 돌아온다', () => {
  const { match, ctx } = setup();
  const waitStep = TUTORIAL_STEPS.find((s) => s.title === '건설 기다리기');
  waitStep.start(ctx);
  assert.equal(match.speed, 4);
  const keep = keepOf(ctx.sim);
  ctx.sim.spawnBuilding('farmstead', 0, keep.x + 8, keep.y, { complete: true });
  assert.equal(waitStep.done(ctx), true);
  assert.equal(match.speed, 1);
});
