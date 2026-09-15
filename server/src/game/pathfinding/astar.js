const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];
const MAX_EXPANSIONS = 20000;
const SMOOTH_LOOKAHEAD = 16;

const octile = (dx, dy) => dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);

/** 열린 목록용 최소 힙. f가 같으면 h가 작은 쪽을 먼저 꺼낸다. */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
  }

  push(node, f, h) {
    const items = this.items;
    items.push([f, h, node]);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!MinHeap.less(items[i], items[p])) break;
      [items[i], items[p]] = [items[p], items[i]];
      i = p;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && MinHeap.less(items[l], items[m])) m = l;
        if (r < items.length && MinHeap.less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top[2];
  }

  static less(a, b) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
}

/**
 * 8방향 A*. 탐색용 배열은 미리 할당해 두고 탐색 번호(stamp)로 초기화를 대신한다.
 * 목표는 사각형 영역이다:
 * - adjacent = false: 영역 안의 칸 (이동 명령. 1×1 영역)
 * - adjacent = true: 영역을 둘러싼 한 칸 테두리 (금광·나무·건물 옆으로 가기)
 */
export class Pathfinder {
  constructor(nav) {
    this.nav = nav;
    const n = nav.width * nav.height;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.openStamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.search = 0;
    this.heap = new MinHeap();
  }

  /**
   * @returns {{ tiles: number[], reached: boolean }} tiles: 출발 칸을 뺀 칸 인덱스 경로.
   *   목표에 닿을 수 없으면 목표에 가장 가까웠던 칸까지의 경로와 reached = false
   */
  find(sx, sy, rect, adjacent) {
    const { nav } = this;
    const W = nav.width;
    const pad = adjacent ? 1 : 0;
    const gx0 = rect.x - pad;
    const gy0 = rect.y - pad;
    const gx1 = rect.x + rect.w - 1 + pad;
    const gy1 = rect.y + rect.h - 1 + pad;
    const inRect = (tx, ty) => tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h;
    const isGoal = (tx, ty) => tx >= gx0 && tx <= gx1 && ty >= gy0 && ty <= gy1 && (!adjacent || !inRect(tx, ty));
    const heuristic = (tx, ty) => octile(Math.max(gx0 - tx, 0, tx - gx1), Math.max(gy0 - ty, 0, ty - gy1));

    if (isGoal(sx, sy)) return { tiles: [], reached: true };

    const s = ++this.search;
    const start = sy * W + sx;
    this.heap.clear();
    this.openStamp[start] = s;
    this.g[start] = 0;
    this.parent[start] = -1;
    let best = start;
    let bestH = heuristic(sx, sy);
    this.heap.push(start, bestH, bestH);
    let expansions = 0;

    while (this.heap.size) {
      const cur = this.heap.pop();
      if (this.closedStamp[cur] === s) continue;
      this.closedStamp[cur] = s;

      const cx = cur % W;
      const cy = (cur - cx) / W;
      if (cur !== start && isGoal(cx, cy)) return { tiles: this.trace(cur, start), reached: true };

      const h = heuristic(cx, cy);
      if (h < bestH) {
        bestH = h;
        best = cur;
      }
      if (++expansions > MAX_EXPANSIONS) break;

      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!nav.inside(nx, ny)) continue;
        const n = ny * W + nx;
        if (nav.blocked[n] || this.closedStamp[n] === s) continue;
        if (dx && dy && (nav.blocked[cy * W + nx] || nav.blocked[ny * W + cx])) continue; // 모서리 끼기 금지
        const ng = this.g[cur] + cost;
        if (this.openStamp[n] !== s || ng < this.g[n]) {
          this.openStamp[n] = s;
          this.g[n] = ng;
          this.parent[n] = cur;
          const hn = heuristic(nx, ny);
          this.heap.push(n, ng + hn, hn);
        }
      }
    }
    return { tiles: this.trace(best, start), reached: false };
  }

  trace(end, start) {
    const tiles = [];
    for (let i = end; i !== start && i !== -1; i = this.parent[i]) tiles.push(i);
    return tiles.reverse();
  }
}

/** 두 점 사이를 radius 두께로 지나갈 수 있는지 (유닛 반지름만큼 벽에서 떨어지게) */
export function lineOfSight(nav, ax, ay, bx, by, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return true;
  const px = (-dy / length) * radius;
  const py = (dx / length) * radius;
  const steps = Math.ceil(length / 0.1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + dx * t;
    const y = ay + dy * t;
    if (
      nav.isBlocked(Math.floor(x), Math.floor(y)) ||
      nav.isBlocked(Math.floor(x + px), Math.floor(y + py)) ||
      nav.isBlocked(Math.floor(x - px), Math.floor(y - py))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 칸 경로를 이동용 웨이포인트([x, y] 타일 좌표, 칸 중심)로 바꾸고,
 * 시야선이 닿는 먼 칸으로 건너뛰어 꺾는 점을 줄인다.
 */
export function toWaypoints(nav, fromX, fromY, tiles, radius) {
  const W = nav.width;
  const points = tiles.map((i) => [(i % W) + 0.5, Math.floor(i / W) + 0.5]);
  const waypoints = [];
  let ax = fromX;
  let ay = fromY;
  let k = 0;
  while (k < points.length) {
    let next = k;
    for (let j = Math.min(points.length - 1, k + SMOOTH_LOOKAHEAD); j > k; j--) {
      if (lineOfSight(nav, ax, ay, points[j][0], points[j][1], radius)) {
        next = j;
        break;
      }
    }
    waypoints.push(points[next]);
    [ax, ay] = points[next];
    k = next + 1;
  }
  return waypoints;
}
