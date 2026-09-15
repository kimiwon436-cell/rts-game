import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../src/map/maps/index.js';
import { isBlockingTerrain } from '../src/map/grid.js';

const map = loadMap('duel01');
const { width: W, height: H, tiles } = map;
const facilities = [...map.starts.map((s) => ({ id: `keep${s.slot}`, ...s.keep })), ...map.goldMines, ...map.wells];

test('지형이 맵 중심에 대해 점대칭이다', () => {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      assert.equal(tiles[y * W + x], tiles[(H - 1 - y) * W + (W - 1 - x)], `(${x}, ${y})`);
    }
  }
});

test('시설 아래에는 막힌 지형이 없다', () => {
  for (const r of facilities) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        assert.ok(!isBlockingTerrain(tiles[y * W + x]), `${r.id} (${x}, ${y})`);
      }
    }
  }
});

test('P1 본진에서 모든 시설까지 걸어서 닿는다', () => {
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) blocked[i] = isBlockingTerrain(tiles[i]) ? 1 : 0;
  for (const r of facilities) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) blocked[y * W + x] = 1;
  }

  const keep = map.starts[0].keep;
  const start = (keep.y + keep.h) * W + keep.x; // 본진 바로 아래 칸
  assert.equal(blocked[start], 0, '출발 칸이 막혀 있다');

  const seen = new Uint8Array(W * H);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!blocked[n] && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }

  for (const r of facilities) {
    let reachable = false;
    for (let y = r.y - 1; y <= r.y + r.h && !reachable; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && seen[y * W + x]) {
          reachable = true;
          break;
        }
      }
    }
    assert.ok(reachable, `닿을 수 없는 시설: ${r.id}`);
  }
});
