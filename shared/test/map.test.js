import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, GAME_MODES, loadMap } from '../src/map/maps/index.js';
import { isBlockingTerrain } from '../src/map/grid.js';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const { id, mode } of MAP_LIST) {
  const map = loadMap(id);
  const { width: W, height: H, tiles } = map;
  const facilities = [...map.starts.map((s) => ({ id: `keep${s.slot}`, ...s.keep })), ...map.goldMines, ...map.wells];

  test(`${id}: 지형이 맵 중심에 대해 점대칭이다`, () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (tiles[y * W + x] !== tiles[(H - 1 - y) * W + (W - 1 - x)]) assert.fail(`(${x}, ${y})`);
      }
    }
  });

  test(`${id}: 모드에 맞는 인원과 팀 배치 (${mode})`, () => {
    const size = GAME_MODES[mode].teamSize;
    assert.equal(map.teamSize, size);
    assert.equal(map.starts.length, size * 2);
    map.starts.forEach((start, i) => {
      assert.equal(start.slot, i);
      assert.equal(start.team, i % 2, '짝수 슬롯은 팀 0, 홀수 슬롯은 팀 1');
    });
  });

  test(`${id}: 시설은 맵 안의 트인 땅에 있고 서로 겹치지 않는다`, () => {
    for (const r of facilities) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${r.id}이 맵 밖에 있다`);
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          assert.ok(!isBlockingTerrain(tiles[y * W + x]), `${r.id} (${x}, ${y})`);
        }
      }
    }
    for (let i = 0; i < facilities.length; i++) {
      for (let j = i + 1; j < facilities.length; j++) {
        assert.ok(!overlaps(facilities[i], facilities[j]), `${facilities[i].id}와 ${facilities[j].id}가 겹친다`);
      }
    }
  });

  test(`${id}: 모든 본진에서 모든 시설까지 걸어서 닿고, 가까이에 금광이 있다`, () => {
    const blocked = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) blocked[i] = isBlockingTerrain(tiles[i]) ? 1 : 0;
    for (const r of facilities) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) blocked[y * W + x] = 1;
    }

    for (const { slot, keep } of map.starts) {
      const start = (keep.y + keep.h) * W + keep.x; // 본진 바로 아래 칸
      assert.equal(blocked[start], 0, `슬롯 ${slot}의 출발 칸이 막혀 있다`);
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
        assert.ok(reachable, `슬롯 ${slot}에서 닿을 수 없는 시설: ${r.id}`);
      }

      const cx = keep.x + keep.w / 2;
      const cy = keep.y + keep.h / 2;
      const nearest = Math.min(...map.goldMines.map((g) => Math.hypot(g.x + g.w / 2 - cx, g.y + g.h / 2 - cy)));
      assert.ok(nearest <= 14, `슬롯 ${slot} 본진 옆 금광이 멀다 (${nearest.toFixed(1)}타일)`);
    }
  });
}
