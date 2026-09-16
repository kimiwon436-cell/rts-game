// 터치 제스처 인식: 탭·두 번 탭·끌기·길게 눌러 끌기·핀치·건물 미리보기 끌기
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TouchControls } from '../src/input/TouchControls.js';

const fakeCanvas = () => ({ addEventListener() {}, removeEventListener() {}, setPointerCapture() {} });
const ev = (pointerId, x, y, pointerType = 'touch') => ({ pointerId, clientX: x, clientY: y, pointerType, preventDefault() {} });

function setup(extra = {}) {
  const calls = [];
  const log = (name) => (...args) => calls.push([name, ...args]);
  const controls = new TouchControls(fakeCanvas(), {
    onTap: log('tap'),
    onDoubleTap: log('doubleTap'),
    onPan: log('pan'),
    onZoom: log('zoom'),
    onBox: log('box'),
    onGhost: log('ghost'),
    ...extra,
  });
  return { controls, calls, names: () => calls.map((c) => c[0]) };
}

test('살짝 눌렀다 떼면 탭, 곧바로 한 번 더 누르면 두 번 탭', () => {
  const { controls, calls, names } = setup();
  controls.down(ev(1, 100, 100));
  controls.move(ev(1, 104, 103)); // 10px 안의 흔들림은 탭으로 본다
  controls.up(ev(1, 104, 103));
  assert.deepEqual(calls, [['tap', 104, 103]]);

  controls.down(ev(2, 110, 100));
  controls.up(ev(2, 110, 100));
  assert.deepEqual(names(), ['tap', 'doubleTap']);
  controls.destroy();
});

test('한 손가락으로 끌면 화면 이동이고 탭이 되지 않는다', () => {
  const { controls, calls, names } = setup();
  controls.down(ev(1, 100, 100));
  controls.move(ev(1, 130, 100)); // 문턱을 넘는 순간 그동안 움직인 만큼 한 번에
  controls.move(ev(1, 140, 90));
  controls.up(ev(1, 140, 90));
  assert.deepEqual(names(), ['pan', 'pan']);
  assert.deepEqual(calls[0], ['pan', 30, 0]);
  assert.deepEqual(calls[1], ['pan', 10, -10]);
  controls.destroy();
});

test('길게 누른 채 끌면 사각형 선택', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { controls, calls } = setup();
    controls.down(ev(1, 50, 60));
    mock.timers.tick(400);
    controls.move(ev(1, 150, 160));
    controls.up(ev(1, 150, 160));
    assert.deepEqual(calls, [
      ['box', 'start', 50, 60],
      ['box', 'move', 150, 160],
      ['box', 'end', 150, 160],
    ]);
    controls.destroy();
  } finally {
    mock.timers.reset();
  }
});

test('두 손가락을 벌리면 확대, 오므리면 축소, 끝나도 탭이 나가지 않는다', () => {
  const { controls, calls, names } = setup();
  controls.down(ev(1, 100, 200));
  controls.down(ev(2, 200, 200)); // 거리 100, 중심 (150, 200)
  controls.move(ev(2, 240, 200)); // 거리 140 → 1.4배
  assert.ok(calls.some((c) => c[0] === 'zoom' && c[1] === 1), '벌리면 확대');

  controls.move(ev(2, 190, 200)); // 140 → 90, 0.64배
  assert.ok(calls.some((c) => c[0] === 'zoom' && c[1] === -1), '오므리면 축소');

  controls.up(ev(1, 100, 200));
  controls.move(ev(2, 260, 260)); // 한 손가락이 남아도 화면이 튀지 않는다
  controls.up(ev(2, 260, 260));
  assert.equal(names().includes('tap'), false);
  assert.equal(calls.filter((c) => c[0] === 'pan').every((c) => Math.abs(c[1]) < 60), true);
  controls.destroy();
});

test('건물을 놓는 중이면 끌기가 미리보기를 옮기고 떼면 짓는다', () => {
  let placing = true;
  const { controls, calls } = setup({ dragsGhost: () => placing });
  controls.down(ev(1, 10, 10));
  controls.move(ev(1, 60, 70));
  controls.up(ev(1, 60, 70));
  assert.deepEqual(calls, [
    ['ghost', 'start', 10, 10],
    ['ghost', 'move', 60, 70],
    ['ghost', 'end', 60, 70],
  ]);
  placing = false;
  controls.destroy();
});

test('마우스 포인터는 무시한다 (마우스는 Input.js가 맡는다)', () => {
  const { controls, calls } = setup();
  controls.down(ev(1, 10, 10, 'mouse'));
  controls.up(ev(1, 10, 10, 'mouse'));
  assert.deepEqual(calls, []);
  controls.destroy();
});
