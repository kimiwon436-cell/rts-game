import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 2v2 "쌍둥이 협곡" (128×128). 한 팀의 두 본진이 왼쪽 아래 구석을 나눠 쓰고, 뒷마당 샘을 함께 지킨다.
 * 대각선 위의 두 샘은 양 팀에서 거리가 같다.
 */
export function createTeam01() {
  const m = createMapBuilder({ width: 128, height: 128, seed: 0x54574e53 });
  const { TREE, WATER, ROCK } = TERRAIN;

  m.blob(4, 124, 6, TREE); // 구석 뒤
  m.blob(24, 100, 3, TREE); // 두 본진 사이
  m.blob(62, 98, 4, TREE);
  m.blob(28, 62, 4, TREE);
  m.blob(48, 86, 3, TREE);
  m.blob(72, 104, 4, WATER);
  m.blob(40, 40, 3, WATER); // 대각선 위 호수 (대칭은 87, 87)
  m.blob(54, 72, 2.5, ROCK);
  m.blob(80, 94, 2, ROCK);
  m.scatter(110, TREE, (x, y) => y > x + 6);

  return m.finish({
    id: 'team01',
    name: '쌍둥이 협곡',
    description: '두 본진이 구석을 나눠 쓰는 2대2 맵. 뒷마당 샘을 함께 지키고 대각선 샘을 다툰다.',
    teamSize: 2,
    bases: [
      {
        keep: { x: 10, y: 82, w: 4, h: 4 },
        gold: [
          { x: 4, y: 74, w: 3, h: 3, amount: 2000 },
          { x: 18, y: 70, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 22, y: 90, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 40, y: 112, w: 4, h: 4 },
        gold: [
          { x: 48, y: 120, w: 3, h: 3, amount: 2000 },
          { x: 56, y: 106, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 30, y: 118, w: 2, h: 2, kind: 'home' }],
      },
    ],
    sharedGold: [{ x: 44, y: 64, w: 3, h: 3, amount: 3000 }],
    sharedWells: [
      { x: 12, y: 114, w: 2, h: 2, kind: 'expansion' }, // 팀 뒷마당
      { x: 30, y: 30, w: 2, h: 2, kind: 'contested' }, // 대각선 위: 양 팀에서 거리가 같다
    ],
    primordial: { x: 63, y: 63, w: 2, h: 2, kind: 'primordial' },
  });
}
