import { TERRAIN } from '../grid.js';
import { createMapBuilder } from '../builder.js';

/**
 * 2v2 "쌍둥이 협곡" (128×128). 바다에 둘러싸인 섬.
 * 한 팀의 두 본진 옆으로 강이 하나씩 흘러 합쳐진 뒤 가운데 섬을 지나 상대 팀의 두 강으로 이어진다.
 * 두 강 사이 구석은 다리로만 들어가는 팀 뒷마당이다.
 */
export function createTeam01() {
  const m = createMapBuilder({ width: 128, height: 128, seed: 0x54574e53 });
  const { TREE, ROCK } = TERRAIN;

  m.blob(10, 120, 4, TREE); // 뒷마당 숲
  m.blob(62, 98, 4, TREE);
  m.blob(28, 62, 4, TREE);
  m.blob(84, 108, 3.5, TREE);
  m.blob(46, 70, 2.2, ROCK);
  m.blob(80, 94, 2, ROCK);
  m.scatter(110, TREE, (x, y) => y > x + 6);

  // 바다와 강: 왼쪽 본진 남쪽 강 + 아래 본진 서쪽 강 → 합쳐져 가운데 섬을 감싼다 (대칭으로 상대 팀 쪽)
  m.sea(4);
  m.river([{ x: -3, y: 100 }, { x: 14, y: 99 }, { x: 28, y: 95 }, { x: 40, y: 88 }], 2);
  m.river([{ x: 28, y: 131 }, { x: 29, y: 116 }, { x: 33, y: 101 }, { x: 40, y: 88 }], 2);
  m.river([{ x: 40, y: 88 }, { x: 50, y: 78 }, { x: 57, y: 70 }], 2.3);
  m.river([{ x: 57, y: 70 }, { x: 53, y: 63 }, { x: 56, y: 55 }, { x: 64, y: 52 }, { x: 71, y: 58 }], 2); // 섬 서쪽·북쪽 물길

  // 다리: 뒷마당으로 둘, 두 본진 사이 하나, 가운데 섬 하나 (대칭으로 하나씩 더)
  m.bridge({ x: 17, y: 92 }, { x: 19, y: 106 });
  m.bridge({ x: 23, y: 109 }, { x: 37, y: 108 });
  m.bridge({ x: 41, y: 75 }, { x: 53, y: 86 });
  m.bridge({ x: 47, y: 62 }, { x: 59, y: 63 });

  return m.finish({
    id: 'team01',
    name: '쌍둥이 협곡',
    description: '두 본진 옆으로 흐르는 강이 합쳐져 가운데 섬을 지나는 2대2 섬 맵. 두 강 사이 뒷마당을 함께 지킨다.',
    teamSize: 2,
    bases: [
      {
        keep: { x: 10, y: 82, w: 4, h: 4 },
        gold: [
          { x: 8, y: 72, w: 3, h: 3, amount: 2000 },
          { x: 20, y: 70, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 22, y: 86, w: 2, h: 2, kind: 'home' }],
      },
      {
        keep: { x: 40, y: 112, w: 4, h: 4 },
        gold: [
          { x: 50, y: 117, w: 3, h: 3, amount: 2000 },
          { x: 56, y: 104, w: 3, h: 3, amount: 2500 },
        ],
        wells: [{ x: 52, y: 111, w: 2, h: 2, kind: 'home' }],
      },
    ],
    sharedGold: [{ x: 38, y: 60, w: 3, h: 3, amount: 3000 }],
    sharedWells: [
      { x: 12, y: 112, w: 2, h: 2, kind: 'expansion' }, // 팀 뒷마당 (두 강 사이)
      { x: 30, y: 30, w: 2, h: 2, kind: 'contested' }, // 대각선 위: 양 팀에서 거리가 같다
    ],
    primordial: { x: 63, y: 63, w: 2, h: 2, kind: 'primordial' },
  });
}
