import { TERRAIN, isBlockingTerrain } from '../grid.js';
import { mulberry32 } from '../../random.js';

const SIZE = 96;

/**
 * 1v1 맵 "duel01" — 기획서의 맵 개념도를 96×96 타일로 옮겼다.
 * P1(왼쪽 아래)을 기준으로 배치하고, 맵 중심에 대해 점대칭으로 P2 쪽을 만든다.
 * 서버와 클라이언트가 같은 코드로 같은 맵을 만들기 때문에 네트워크로는 mapId만 보낸다.
 */
export function createDuel01() {
  const tiles = new Uint8Array(SIZE * SIZE); // 기본은 풀밭(0)
  const rand = mulberry32(0x52554e45);

  const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  const get = (x, y) => tiles[y * SIZE + x];
  // 타일 하나를 바꾸면 대칭 위치도 함께 바꾼다 — 그래서 결과는 항상 공정하다
  const setSym = (x, y, t) => {
    if (!inside(x, y)) return;
    tiles[y * SIZE + x] = t;
    tiles[(SIZE - 1 - y) * SIZE + (SIZE - 1 - x)] = t;
  };
  const mirrorRect = ({ x, y, w, h }) => ({ x: SIZE - w - x, y: SIZE - h - y, w, h });
  const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  // P1 쪽 시설 (P2 쪽은 대칭)
  const p1Keep = { x: 14, y: 78, w: 4, h: 4 };
  const p1Gold = [
    { x: 7, y: 70, w: 3, h: 3, amount: 2000 }, // 본진 금광
    { x: 5, y: 50, w: 3, h: 3, amount: 3000 }, // 앞마당 금광
  ];
  const p1Wells = [
    { x: 30, y: 84, w: 2, h: 2, kind: 'home' },
    { x: 13, y: 47, w: 2, h: 2, kind: 'expansion' },
    { x: 26, y: 26, w: 2, h: 2, kind: 'contested' },
  ];
  const primordial = { x: 47, y: 47, w: 2, h: 2, kind: 'primordial' };

  const blob = (cx, cy, r, terrain) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy) + (rand() - 0.5) * 1.2;
        if (d < r) setSym(x, y, terrain);
      }
    }
  };

  // 1) 숲, 호수, 바위
  blob(5, 90, 6, TERRAIN.TREE); // 본진 뒤
  blob(3, 60, 4, TERRAIN.TREE); // 왼쪽 가장자리
  blob(48, 93, 5, TERRAIN.TREE); // 아래 가운데
  blob(86, 88, 6, TERRAIN.TREE); // 오른쪽 아래 모서리
  blob(36, 76, 3, TERRAIN.TREE); // 본진 앞 작은 숲
  blob(22, 40, 4, TERRAIN.TREE); // 왼쪽 중간
  blob(30, 58, 3.5, TERRAIN.WATER);
  blob(58, 84, 3, TERRAIN.WATER);
  blob(42, 57, 2.2, TERRAIN.ROCK);
  blob(54, 74, 2, TERRAIN.ROCK);

  // 2) 흩어진 나무
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    if (y > x) setSym(x, y, TERRAIN.TREE);
  }

  // 3) 본진 공터
  const kc = centerOf(p1Keep);
  for (let y = kc.y - 9; y <= kc.y + 9; y++) {
    for (let x = kc.x - 9; x <= kc.x + 9; x++) {
      const d = Math.hypot(x + 0.5 - kc.x, y + 0.5 - kc.y) + (rand() - 0.5) * 1.5;
      if (d < 7.5) setSym(x, y, TERRAIN.DIRT);
    }
  }

  // 4) 시설 주변과 본진에서 시설까지의 길목을 비워 모든 시설에 걸어서 닿게 한다
  const clearRect = ({ x, y, w, h }, margin) => {
    for (let ty = y - margin; ty < y + h + margin; ty++) {
      for (let tx = x - margin; tx < x + w + margin; tx++) {
        if (inside(tx, ty) && isBlockingTerrain(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
      }
    }
  };
  const carveLine = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let s = 0; s <= steps; s++) {
      const px = a.x + ((b.x - a.x) * s) / steps;
      const py = a.y + ((b.y - a.y) * s) / steps;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = Math.floor(px) + ox;
          const ty = Math.floor(py) + oy;
          if (inside(tx, ty) && isBlockingTerrain(get(tx, ty))) setSym(tx, ty, TERRAIN.GRASS);
        }
      }
    }
  };

  clearRect(p1Keep, 3);
  p1Gold.forEach((g) => clearRect(g, 2));
  [...p1Wells, primordial].forEach((w) => clearRect(w, 3));
  for (const target of [...p1Gold, ...p1Wells, primordial]) carveLine(kc, centerOf(target));

  const goldMines = [...p1Gold, ...p1Gold.map((g) => ({ ...mirrorRect(g), amount: g.amount }))];
  const wells = [...p1Wells, ...p1Wells.map((w) => ({ ...mirrorRect(w), kind: w.kind })), primordial];

  return {
    id: 'duel01',
    name: '갈라진 레이 라인',
    width: SIZE,
    height: SIZE,
    tiles,
    starts: [p1Keep, mirrorRect(p1Keep)].map((keep, slot) => ({ slot, keep })),
    goldMines: goldMines.map((g, i) => ({ id: `gold${i}`, ...g })),
    wells: wells.map((w, i) => ({ id: `well${i}`, ...w, rate: w.kind === 'primordial' ? 4 : 1.5 })),
  };
}
