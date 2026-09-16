import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 3v3 "왕관의 평원" (144×144). 한 팀의 세 본진이 구석·왼쪽·아래에 흩어져 서로를 받친다.
 * 가운데 평원에 공용 금광과 샘이 몰려 있어 전선이 넓다.
 */
export function createTeam02() {
  const m = createMapBuilder({ width: 144, height: 144, seed: 0x43524f57 });
  const { TREE, WATER, ROCK } = TERRAIN;

  m.blob(3, 140, 6, TREE);
  m.blob(22, 106, 3.5, TREE);
  m.blob(32, 124, 3, TREE);
  m.blob(36, 58, 4.5, TREE);
  m.blob(88, 120, 4.5, TREE);
  m.blob(60, 100, 3, TREE);
  m.blob(52, 118, 3.5, WATER);
  m.blob(24, 56, 3, WATER);
  m.blob(48, 48, 3, WATER); // 대각선 위 (대칭은 95, 95)
  m.blob(64, 88, 2.5, ROCK);
  m.blob(84, 102, 2.2, ROCK);
  m.scatter(150, TREE, (x, y) => y > x + 6);

  return m.finish({
    id: 'team02',
    name: '왕관의 평원',
    description: '세 본진이 서로를 받치는 3대3 맵. 넓은 가운데 평원의 금광과 샘이 승부처다.',
    teamSize: 3,
    bases: [
      {
        keep: { x: 12, y: 126, w: 4, h: 4 }, // 구석
        gold: [
          { x: 4, y: 118, w: 3, h: 3, amount: 2000 },
          { x: 22, y: 136, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 24, y: 122, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 10, y: 88, w: 4, h: 4 }, // 왼쪽
        gold: [
          { x: 4, y: 80, w: 3, h: 3, amount: 2000 },
          { x: 20, y: 76, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 22, y: 96, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 50, y: 130, w: 4, h: 4 }, // 아래
        gold: [
          { x: 58, y: 138, w: 3, h: 3, amount: 2000 },
          { x: 64, y: 124, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 40, y: 134, w: 2, h: 2, kind: 'home' }],
      },
    ],
    sharedGold: [
      { x: 40, y: 70, w: 3, h: 3, amount: 3000 },
      { x: 72, y: 104, w: 3, h: 3, amount: 3000 },
    ],
    sharedWells: [
      { x: 30, y: 108, w: 2, h: 2, kind: 'expansion' },
      { x: 36, y: 36, w: 2, h: 2, kind: 'contested' },
      { x: 56, y: 84, w: 2, h: 2, kind: 'contested' },
    ],
    primordial: { x: 71, y: 71, w: 2, h: 2, kind: 'primordial' },
  });
}
