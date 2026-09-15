// 경제 규칙 — docs/GAME_DESIGN.md 1·2·5장

export const RESOURCES = Object.freeze(['gold', 'wood', 'mana']);
export const RESOURCE_NAMES = Object.freeze({ gold: '금', wood: '목재', mana: '마나' });

export const STARTING_RESOURCES = Object.freeze({ gold: 200, wood: 200, mana: 0 });
export const STARTING_WORKERS = 4;
export const POP_LIMIT = 100;
export const WOOD_PER_TREE = 100;

/** 시대. 발전은 영주관에서 한다. MVP는 성채 시대까지 */
export const AGES = Object.freeze({
  1: { name: '촌락 시대', keepName: '영주관' },
  2: {
    name: '성채 시대',
    keepName: '성채',
    cost: { gold: 300, wood: 200, mana: 100 },
    time: 60,
    requires: ['barracks'],
  },
});
export const MAX_AGE = 2;

/** 여러 농노가 함께 지을 때의 속도 배율: 1명 1배, 2명 1.33배, 3명 1.67배 */
export const buildSpeedMultiplier = (builders) => (builders <= 0 ? 0 : (builders + 2) / 3);
