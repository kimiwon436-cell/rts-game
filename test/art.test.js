// 그림: 모든 유닛·건물에 그림이 있는가, 유닛이 언제 어떤 동작을 보여 주는가 (그리기 자체는 /gallery.html에서 눈으로 본다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_TYPES } from '@rune/shared/data/units.js';
import { BUILDING_TYPES } from '@rune/shared/data/buildings.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { UNIT_ART_TYPES, unitPose } from '../src/render/art/unitArt.js';
import { BUILDING_ART_TYPES } from '../src/render/art/buildingArt.js';
import { ClientWorld } from '../src/world/ClientWorld.js';

const unit = (type, extra = {}) => ({ id: 3, type, owner: 0, drawX: 5, drawY: 5, facing: 1, state: UNIT_STATE.IDLE, ...extra });

test('모든 유닛과 건물에 그림이 있다 (없으면 그리다 멈춘다)', () => {
  assert.deepEqual(UNIT_TYPES.filter((type) => !UNIT_ART_TYPES.includes(type)), []);
  assert.deepEqual(BUILDING_TYPES.filter((type) => !BUILDING_ART_TYPES.includes(type)), []);
});

test('동작: 서 있기 · 실제로 움직일 때만 걷기 · 싸울 자세 · 친 순간부터 0.36초 공격', () => {
  assert.deepEqual(unitPose(unit('pikeman'), 5000), { kind: 'idle', frame: 0 });
  // 이동 명령을 받았어도 막혀 제자리면 걷지 않는다
  assert.equal(unitPose(unit('pikeman', { state: UNIT_STATE.MOVE, still: 30 }), 5000).kind, 'idle');
  const frames = new Set();
  for (let t = 5000; t < 5600; t += 40) {
    const pose = unitPose(unit('pikeman', { state: UNIT_STATE.MOVE, still: 0 }), t);
    assert.equal(pose.kind, 'walk');
    frames.add(pose.frame);
  }
  assert.deepEqual([...frames].sort(), [0, 1, 2, 3], '걷기 네 프레임을 돈다');
  assert.deepEqual(unitPose(unit('pikeman', { state: UNIT_STATE.ATTACK, still: 20 }), 5000), { kind: 'ready', frame: 0 });
  const struck = (ms) => unitPose(unit('pikeman', { state: UNIT_STATE.ATTACK, still: 20, attackAt: 5000 }), 5000 + ms);
  assert.deepEqual([struck(0), struck(150), struck(300)].map((p) => `${p.kind}${p.frame}`), ['strike0', 'strike1', 'strike2']);
  assert.equal(struck(400).kind, 'ready', '다 치면 다시 겨눈다');
});

test('농노는 캐거나 지을 때 일하는 동작, 공중 유닛은 늘 날갯짓한다', () => {
  assert.equal(unitPose(unit('peasant', { state: UNIT_STATE.GATHER, still: 20 }), 5000).kind, 'work');
  assert.equal(unitPose(unit('peasant', { state: UNIT_STATE.BUILD, still: 20 }), 5000).kind, 'work');
  assert.equal(unitPose(unit('peasant', { state: UNIT_STATE.GATHER, still: 0 }), 5000).kind, 'walk', '자원으로 걸어가는 중');
  const flaps = new Set();
  for (let t = 5000; t < 5700; t += 30) flaps.add(unitPose(unit('storm_wyvern', { still: 30 }), t).frame);
  assert.equal(flaps.size, 4);
  assert.equal(unitPose(unit('gryphon_rider', { state: UNIT_STATE.ATTACK }), 5000).kind, 'ready');
});

test('공격 이벤트: 친 쪽이 공격 동작을 시작하고 맞은 쪽을 바라본다. 움직임이 멎으면 still이 쌓인다', () => {
  const world = new ClientWorld(loadMap('duel01'), 0, [
    { slot: 0, team: 0 },
    { slot: 1, team: 1 },
  ]);
  const archer = { id: 1, type: 'longbowman', owner: 0, x: 10, y: 10, drawX: 10, drawY: 10, facing: 1, samples: [{ t: 0, x: 10, y: 10 }] };
  const target = { id: 2, type: 'pikeman', owner: 1, x: 6, y: 10, drawX: 6, drawY: 10, facing: 1, samples: [{ t: 0, x: 6, y: 10 }] };
  world.units.set(1, archer);
  world.units.set(2, target);
  world.addCombatEffect([GAME_EVENT.ATTACK, 1, 2], new Map());
  assert.ok(archer.attackAt > 0);
  assert.equal(archer.facing, -1, '왼쪽의 적을 본다');
  assert.equal(world.effects.at(-1).kind, 'arrow');
  world.interpolateAt(1);
  world.interpolateAt(2);
  assert.equal(archer.still, 2);
});
