import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 3v3 "왕관의 평원" (144×144). 바다에 둘러싸인 섬.
 * 한 팀의 세 본진(구석·왼쪽·아래) 사이로 강 두 줄기가 흘러 합쳐지고, 가운데 섬을 지나 상대 팀 쪽으로 이어진다.
 * 구석 본진은 두 강 사이에 있어 다리로 이웃 본진과 이어진다. 넓은 평원의 공용 금광과 샘이 승부처다.
 */
export function createTeam02() {
  const m = createMapBuilder({ width: 144, height: 144, seed: 0x43524f57 });
  const { TREE, ROCK } = TERRAIN;

  m.blob(6, 134, 4, TREE);
  m.blob(26, 84, 3.5, TREE);
  m.blob(36, 58, 4.5, TREE);
  m.blob(88, 120, 4.5, TREE);
  m.blob(62, 104, 3, TREE);
  m.blob(70, 96, 2.5, ROCK);
  m.blob(84, 102, 2.2, ROCK);
  m.scatter(150, TREE, (x, y) => y > x + 6);

  // 바다와 강: 구석·왼쪽 본진 사이 강 + 구석·아래 본진 사이 강 → 합쳐져 가운데 섬을 감싼다
  m.sea(4);
  m.river([{ x: -3, y: 110 }, { x: 16, y: 108 }, { x: 32, y: 104 }, { x: 44, y: 98 }], 2);
  m.river([{ x: 32, y: 147 }, { x: 33, y: 130 }, { x: 37, y: 112 }, { x: 44, y: 98 }], 2);
  m.river([{ x: 44, y: 98 }, { x: 56, y: 88 }, { x: 63, y: 80 }], 2.3);
  m.river([{ x: 63, y: 80 }, { x: 60, y: 72 }, { x: 63, y: 64 }, { x: 71, y: 61 }, { x: 81, y: 64 }], 2); // 섬 서쪽·북쪽 물길

  // 다리: 구석↔왼쪽, 구석↔아래, 왼쪽↔아래, 가운데 섬 (대칭으로 하나씩 더)
  m.bridge({ x: 12, y: 101 }, { x: 13, y: 115 });
  m.bridge({ x: 26, y: 124 }, { x: 41, y: 124 });
  m.bridge({ x: 45, y: 86 }, { x: 56, y: 99 });
  m.bridge({ x: 53, y: 71 }, { x: 66, y: 72 });

  return m.finish({
    id: 'team02',
    name: '왕관의 평원',
    description: '세 본진 사이로 강 두 줄기가 흘러 가운데 섬에서 만나는 3대3 섬 맵. 넓은 가운데 평원의 금광과 샘이 승부처다.',
    teamSize: 3,
    bases: [
      {
        keep: { x: 12, y: 126, w: 4, h: 4 }, // 구석
        gold: [
          { x: 8, y: 116, w: 3, h: 3, amount: 2000 },
          { x: 22, y: 132, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 24, y: 122, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 10, y: 88, w: 4, h: 4 }, // 왼쪽
        gold: [
          { x: 8, y: 78, w: 3, h: 3, amount: 2000 },
          { x: 20, y: 76, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 22, y: 94, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 50, y: 130, w: 4, h: 4 }, // 아래
        gold: [
          { x: 60, y: 134, w: 3, h: 3, amount: 2000 },
          { x: 64, y: 122, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 42, y: 134, w: 2, h: 2, kind: 'home' }],
      },
    ],
    sharedGold: [
      { x: 40, y: 70, w: 3, h: 3, amount: 3000 },
      { x: 74, y: 108, w: 3, h: 3, amount: 3000 },
    ],
    sharedWells: [
      { x: 20, y: 112, w: 2, h: 2, kind: 'expansion' },
      { x: 36, y: 36, w: 2, h: 2, kind: 'contested' },
      { x: 46, y: 80, w: 2, h: 2, kind: 'contested' },
    ],
    primordial: { x: 71, y: 71, w: 2, h: 2, kind: 'primordial' },
  });
}
