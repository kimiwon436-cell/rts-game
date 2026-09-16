import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 1v1 "얼어붙은 강" (96×96). 왼쪽 위에서 오른쪽 아래로 강이 흐르고, 건널 곳은 여울 셋뿐이다.
 * 가운데 여울 섬에 태초의 샘이 있어, 강을 먼저 건너는 쪽이 판을 쥔다.
 */
export function createDuel02() {
  const m = createMapBuilder({ width: 96, height: 96, seed: 0x52495645 });
  const { TREE, WATER, ROCK, GRASS } = TERRAIN;

  // 강과 여울 (강은 대각선 y = x를 따라 흘러 스스로 대칭이다)
  m.band([{ x: -2, y: -2 }, { x: 98, y: 98 }], 2.4, WATER, 1);
  m.blob(22, 22, 4, GRASS, 0.6);
  m.blob(48, 48, 5, GRASS, 0.6);

  // 숲과 바위 (P1 쪽 절반 y > x에만 그리면 대칭으로 P2 쪽이 생긴다)
  m.blob(4, 92, 6, TREE);
  m.blob(40, 72, 4, TREE);
  m.blob(18, 44, 3.5, TREE);
  m.blob(58, 88, 3, ROCK);
  m.blob(30, 64, 2.2, ROCK);
  m.scatter(70, TREE, (x, y) => y > x + 7);

  return m.finish({
    id: 'duel02',
    name: '얼어붙은 강',
    description: '여울 셋으로만 건너는 강. 가운데 섬의 태초의 샘을 두고 싸운다.',
    teamSize: 1,
    bases: [
      {
        keep: { x: 12, y: 80, w: 4, h: 4 },
        gold: [
          { x: 5, y: 72, w: 3, h: 3, amount: 2000 },
          { x: 30, y: 88, w: 3, h: 3, amount: 3000 },
        ],
        wells: [
          { x: 24, y: 84, w: 2, h: 2, kind: 'home' },
          { x: 8, y: 56, w: 2, h: 2, kind: 'expansion' },
        ],
      },
    ],
    sharedGold: [{ x: 38, y: 54, w: 3, h: 3, amount: 2500 }],
    sharedWells: [{ x: 14, y: 28, w: 2, h: 2, kind: 'contested' }],
    primordial: { x: 47, y: 47, w: 2, h: 2, kind: 'primordial' },
  });
}
