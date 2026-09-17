import { isNavigableWater } from './grid.js';

const cache = new WeakMap();

/**
 * 바다(맵 가장자리의 물)와 물길로 이어진 물 칸. 1이면 배가 바다까지 나갈 수 있다.
 * 조선소는 이 물에 닿아야 한다 — 막힌 호수에 지어 배가 갇히지 않게.
 * 물·다리는 경기 중에 바뀌지 않아 맵마다 한 번만 계산한다.
 */
export function seaWater(map) {
  let sea = cache.get(map);
  if (sea) return sea;
  const { width: W, height: H, tiles } = map;
  sea = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const i = y * W + x;
    if (sea[i] || !isNavigableWater(tiles[i])) return;
    sea[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  cache.set(map, sea);
  return sea;
}
