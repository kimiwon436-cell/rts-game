import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisionGrid, sightOf, FOUNDATION_SIGHT } from '../src/rules/vision.js';

test('시야는 칸 중심이 반지름 안에 드는 원이다', () => {
  const vision = new VisionGrid(32, 32);
  vision.begin();
  vision.place(1, 0, 10.5, 10.5, 3);
  vision.end();
  assert.equal(vision.isVisible(0, 10, 10), true);
  assert.equal(vision.isVisible(0, 13.9, 10), true, '오른쪽으로 3칸');
  assert.equal(vision.isVisible(0, 14, 10), false, '4칸은 밖');
  assert.equal(vision.isVisible(0, 12, 12), true, '대각선 (2, 2) ≈ 2.8');
  assert.equal(vision.isVisible(0, 13, 13), false, '대각선 (3, 3) ≈ 4.2');
  assert.equal(vision.isVisible(1, 10, 10), false, '다른 팀은 못 본다');
  assert.equal(vision.isVisible(0, -1, 10), false, '맵 밖');
  assert.equal(vision.isRectVisible(0, { x: 13, y: 9, w: 3, h: 3 }), true, '한 칸이라도 보이면 사각형이 보인다');
  assert.equal(vision.isRectVisible(0, { x: 14, y: 14, w: 3, h: 3 }), false);
});

test('겹친 시야는 개수로 세고, 움직이거나 사라진 시야만 다시 칠한다', () => {
  const vision = new VisionGrid(32, 32, { explored: true });
  vision.begin();
  vision.place('a', 0, 5.5, 5.5, 2);
  vision.place('b', 0, 6.5, 5.5, 2);
  vision.end();
  assert.equal(vision.counts[0][5 * 32 + 6], 2);

  // 그대로면 아무것도 바뀌지 않는다
  const version = vision.version;
  vision.begin();
  vision.place('a', 0, 5.9, 5.1, 2); // 같은 칸 안에서만 움직였다
  vision.place('b', 0, 6.5, 5.5, 2);
  vision.end();
  assert.equal(vision.version, version, '같은 칸이면 다시 칠하지 않는다');

  // b가 사라지고 a가 멀리 갔다
  vision.begin();
  vision.place('a', 0, 20.5, 20.5, 2);
  vision.end();
  assert.equal(vision.isVisible(0, 6, 5), false, '떠난 자리는 다시 안개');
  assert.equal(vision.isExplored(0, 5 * 32 + 6), true, '본 적 있는 칸은 기억한다');
  assert.equal(vision.isVisible(0, 20, 20), true);
  assert.equal(vision.sources.size, 1);
  assert.ok(vision.counts[0].every((count) => count <= 1), '빼고 더한 수가 맞다');

  vision.clear({ keepExplored: true });
  assert.equal(vision.isVisible(0, 20, 20), false);
  assert.equal(vision.isExplored(0, 20 * 32 + 20), true, '재접속: 본 땅은 기억한다');
  vision.clear();
  assert.equal(vision.isExplored(0, 20 * 32 + 20), false, '리플레이 되감기: 기억도 지운다');
});

test('유닛·건물의 시야 값: 짓는 중인 건물은 좁게 본다', () => {
  assert.equal(sightOf('scout_rider'), 10);
  assert.equal(sightOf('peasant'), 6);
  assert.equal(sightOf('watchtower'), 11);
  assert.equal(sightOf('watchtower', false), FOUNDATION_SIGHT);
});
