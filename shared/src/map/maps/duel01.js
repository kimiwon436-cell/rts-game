import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 1v1 "갈라진 레이 라인" (96×96). 바다로 둘러싸인 섬.
 * 두 본진 옆을 지나는 강이 가운데 섬을 휘감아 서로 이어진다 — 배는 강으로 곧장, 또는 바다로 돌아서 간다.
 * 걸어서는 본진 앞의 다리나, 태초의 샘이 있는 가운데 섬의 다리 둘을 건너야 상대 쪽에 닿는다.
 */
export function createDuel01() {
  const m = createMapBuilder({ width: 96, height: 96, seed: 0x52554e45 });
  const { TREE, ROCK } = TERRAIN;

  // 1) 숲과 바위 (P1 쪽을 그리면 대칭으로 P2 쪽이 생긴다)
  m.blob(8, 88, 5, TREE); // 본진 뒤
  m.blob(20, 58, 3.5, TREE); // 본진과 앞마당 사이
  m.blob(24, 40, 4, TREE); // 왼쪽 중간
  m.blob(50, 88, 5, TREE); // 강 건너 아래
  m.blob(84, 84, 5, TREE); // 오른쪽 아래 모서리
  m.blob(28, 34, 2, ROCK);
  m.blob(56, 76, 2, ROCK);
  m.scatter(70, TREE, (x, y) => y > x);

  // 2) 바다와 강: 아래 바다에서 P1 본진 동쪽을 따라 올라와 가운데 섬을 감싸고, 대칭으로 P2 쪽 바다로 나간다
  m.sea(4);
  m.river([{ x: 30, y: 100 }, { x: 31, y: 88 }, { x: 34, y: 76 }, { x: 39, y: 65 }, { x: 43, y: 58 }], 2.2);
  m.river([{ x: 43, y: 58 }, { x: 39, y: 50 }, { x: 41, y: 42 }, { x: 47, y: 38 }, { x: 52, y: 37 }], 2); // 섬 서쪽·북쪽 물길

  // 3) 다리: 본진 앞, 가운데 섬 서쪽 (대칭으로 P2 쪽에도 하나씩)
  m.bridge({ x: 30, y: 70 }, { x: 43, y: 70 });
  m.bridge({ x: 33, y: 49 }, { x: 45, y: 47 });

  return m.finish({
    id: 'duel01',
    name: '갈라진 레이 라인',
    description: '바다에 둘러싸인 섬. 두 본진 옆을 지나는 강이 가운데 섬을 감싸고, 다리 셋으로 건넌다.',
    teamSize: 1,
    bases: [
      {
        keep: { x: 14, y: 78, w: 4, h: 4 },
        gold: [
          { x: 9, y: 70, w: 3, h: 3, amount: 2000 }, // 본진 금광
          { x: 9, y: 50, w: 3, h: 3, amount: 3000 }, // 앞마당 금광
        ],
        wells: [
          { x: 24, y: 69, w: 2, h: 2, kind: 'home' },
          { x: 14, y: 45, w: 2, h: 2, kind: 'expansion' },
        ],
      },
    ],
    sharedWells: [{ x: 26, y: 24, w: 2, h: 2, kind: 'contested' }],
    primordial: { x: 47, y: 47, w: 2, h: 2, kind: 'primordial' },
  });
}
