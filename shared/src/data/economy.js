// 경제 규칙 — docs/GAME_DESIGN.md 1·2·5장

export const RESOURCES = Object.freeze(['gold', 'wood', 'mana']);
export const RESOURCE_NAMES = Object.freeze({ gold: '금', wood: '목재', mana: '마나' });

export const STARTING_RESOURCES = Object.freeze({ gold: 200, wood: 200, mana: 0 });
export const STARTING_WORKERS = 4;
export const POP_LIMIT = 100;
export const WOOD_PER_TREE = 100;

/** 시대. 발전은 영주관에서 한다 */
export const AGES = Object.freeze({
  1: { name: '촌락 시대', keepName: '영주관' },
  2: {
    name: '성채 시대',
    keepName: '성채',
    cost: { gold: 300, wood: 200, mana: 100 },
    time: 60,
    requires: ['barracks'],
  },
  3: {
    name: '왕국 시대',
    keepName: '왕성',
    cost: { gold: 600, wood: 400, mana: 300 },
    time: 90,
    // 성채 시대 건물 2종
    requiresAny: { types: ['mage_tower', 'market'], count: 2 },
  },
});
export const MAX_AGE = 3;

/**
 * 팀원에게 자원 보내기 (팀전). 운송 수수료를 떼고 도착한다.
 * 수수료는 한 사람에게 팀의 자원을 몰아주는 전략을 막지는 않되 공짜로 만들지 않는다.
 */
export const TRIBUTE = Object.freeze({ fee: 0.1, amounts: Object.freeze([100, 500]), max: 10000 });

/** amount를 보내면 받는 쪽에 도착하는 양 */
export const tributeReceived = (amount) => Math.floor(amount * (1 - TRIBUTE.fee));

/**
 * 여러 농노가 함께 지을 때의 속도 배율: 농노가 많을수록 빨라지되 한 명당 효과는 조금씩 준다 (명^0.8)
 * 1명 1배 · 2명 1.7배 · 3명 2.4배 · 4명 3배 · 6명 4.2배 · 8명 5.3배
 */
export const buildSpeedMultiplier = (builders) => (builders <= 0 ? 0 : builders ** 0.8);
