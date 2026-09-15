import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavGrid } from '../src/game/pathfinding/NavGrid.js';
import { Pathfinder, toWaypoints } from '../src/game/pathfinding/astar.js';

/** '#'가 막힌 칸인 그리드 */
function gridFrom(rows) {
  const width = rows[0].length;
  const nav = new NavGrid(width, rows.length, new Uint8Array(width * rows.length));
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '#') nav.blocked[y * width + x] = 1;
  }));
  return nav;
}

test('벽을 돌아 목표 칸까지 가는 경로를 찾는다', () => {
  const nav = gridFrom([
    '..........',
    '....#.....',
    '....#.....',
    '....#.....',
    '..........',
  ]);
  const { tiles, reached } = new Pathfinder(nav).find(1, 2, { x: 8, y: 2, w: 1, h: 1 }, false);
  assert.equal(reached, true);
  assert.equal(tiles.at(-1), 2 * 10 + 8);
  assert.ok(tiles.every((i) => nav.blocked[i] === 0));
});

test('막힌 두 칸의 모서리 사이로 대각선 이동하지 않는다', () => {
  const nav = gridFrom(['.#', '#.']);
  const { reached } = new Pathfinder(nav).find(0, 0, { x: 1, y: 1, w: 1, h: 1 }, false);
  assert.equal(reached, false);
});

test('옆 칸 목표는 막힌 사각형의 둘레 칸에서 끝난다', () => {
  const nav = gridFrom([
    '.......',
    '.......',
    '..###..',
    '..###..',
    '..###..',
    '.......',
    '......S',
  ]);
  const { tiles, reached } = new Pathfinder(nav).find(6, 6, { x: 2, y: 2, w: 3, h: 3 }, true);
  assert.equal(reached, true);
  assert.deepEqual(tiles, [5 * 7 + 5]);
});

test('닿을 수 없는 목표는 가장 가까운 칸까지 간다', () => {
  const nav = gridFrom([
    '.......',
    '.#####.',
    '.#...#.',
    '.#####.',
    '.......',
  ]);
  const { tiles, reached } = new Pathfinder(nav).find(0, 0, { x: 3, y: 2, w: 1, h: 1 }, false);
  assert.equal(reached, false);
  const last = tiles.at(-1);
  assert.equal(nav.blocked[last], 0);
  assert.equal(Math.abs(Math.floor(last / 7) - 2) + Math.abs((last % 7) - 3) <= 3, true);
});

test('뚫린 직선 경로는 웨이포인트 하나로 줄어든다', () => {
  const nav = gridFrom(['..........', '..........', '..........']);
  const { tiles } = new Pathfinder(nav).find(0, 1, { x: 9, y: 1, w: 1, h: 1 }, false);
  assert.equal(tiles.length, 9);
  assert.deepEqual(toWaypoints(nav, 0.5, 1.5, tiles, 0.3), [[9.5, 1.5]]);
});
