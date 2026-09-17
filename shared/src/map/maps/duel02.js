import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 1v1 "세 다리 강" (96×96). 왼쪽 위 바다에서 오른쪽 아래 바다로 큰 강이 흐르고,
 * 강에서 갈라진 물길이 두 본진 앞까지 들어온다. 걸어서는 다리 셋으로만 건넌다 —
 * 가운데 섬의 태초의 샘으로 가는 두 다리와, 강 위쪽·아래쪽의 다리 하나씩.
 */
export function createDuel02() {
  const m = createMapBuilder({ width: 96, height: 96, seed: 0x52495645 });
  const { TREE, ROCK } = TERRAIN;

  // 숲과 바위 (P1 쪽 절반 y > x에만 그리면 대칭으로 P2 쪽이 생긴다)
  m.blob(8, 90, 5, TREE);
  m.blob(40, 76, 4, TREE);
  m.blob(10, 40, 3.5, TREE);
  m.blob(58, 84, 3, ROCK);
  m.blob(34, 64, 2.2, ROCK);
  m.scatter(70, TREE, (x, y) => y > x + 7);

  // 바다, 큰 강(대각선), 가운데 섬을 감싸는 물길, 본진 앞까지 들어오는 물길
  m.sea(4);
  m.river([{ x: -3, y: -3 }, { x: 20, y: 22 }, { x: 40, y: 39 }], 2.4);
  m.river([{ x: 40, y: 39 }, { x: 49, y: 38 }, { x: 57, y: 45 }, { x: 56, y: 56 }], 2.1); // 섬 북동쪽 물길
  m.river([{ x: 22, y: 21 }, { x: 25, y: 36 }, { x: 24, y: 52 }, { x: 22, y: 62 }], 1.9); // P1 본진 앞 물길

  // 다리: 섬으로 가는 남서쪽 다리, 강 위쪽 다리 (대칭으로 하나씩 더)
  m.bridge({ x: 34, y: 54 }, { x: 45, y: 51 });
  m.bridge({ x: 8, y: 16 }, { x: 16, y: 6 });

  return m.finish({
    id: 'duel02',
    name: '세 다리 강',
    description: '두 본진 앞까지 물길이 들어오는 큰 강. 다리 셋으로만 건너고, 가운데 섬의 태초의 샘을 두고 싸운다.',
    teamSize: 1,
    bases: [
      {
        keep: { x: 12, y: 78, w: 4, h: 4 },
        gold: [
          { x: 8, y: 70, w: 3, h: 3, amount: 2000 },
          { x: 30, y: 86, w: 3, h: 3, amount: 3000 },
        ],
        wells: [
          { x: 24, y: 80, w: 2, h: 2, kind: 'home' },
          { x: 9, y: 56, w: 2, h: 2, kind: 'expansion' },
        ],
      },
    ],
    sharedGold: [{ x: 38, y: 60, w: 3, h: 3, amount: 2500 }],
    sharedWells: [{ x: 12, y: 30, w: 2, h: 2, kind: 'contested' }],
    primordial: { x: 47, y: 47, w: 2, h: 2, kind: 'primordial' },
  });
}
