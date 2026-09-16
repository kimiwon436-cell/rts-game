// 유닛 능력치 — docs/GAME_DESIGN.md 3·4장 (기본 7종 + 맹세의 궁극 유닛 3종)
// 사거리·이동 속도·반지름은 타일 단위, 생산 시간·공격 간격은 초 단위

export const UNITS = Object.freeze({
  peasant: {
    id: 'peasant',
    name: '농노',
    age: 1,
    producedAt: 'keep',
    cost: { gold: 50, wood: 0, mana: 0 },
    trainTime: 12,
    pop: 1,
    hp: 60,
    armor: 'light',
    speed: 2.5,
    radius: 0.3,
    attack: { damage: 5, type: 'normal', range: 1, cooldown: 1.5 },
    worker: true,
  },
  pikeman: {
    id: 'pikeman',
    name: '창병',
    age: 1,
    producedAt: 'barracks',
    cost: { gold: 35, wood: 25, mana: 0 },
    trainTime: 18,
    pop: 1,
    hp: 110,
    armor: 'light',
    speed: 2.4,
    radius: 0.32,
    attack: { damage: 9, type: 'normal', range: 1, cooldown: 1.2 },
    bonusVsTag: { cavalry: 3 },
  },
  longbowman: {
    id: 'longbowman',
    name: '장궁병',
    age: 1,
    producedAt: 'barracks',
    cost: { gold: 30, wood: 45, mana: 0 },
    trainTime: 20,
    pop: 1,
    hp: 70,
    armor: 'light',
    speed: 2.4,
    radius: 0.3,
    attack: { damage: 12, type: 'pierce', range: 6, cooldown: 1.6 },
  },
  scout_rider: {
    id: 'scout_rider',
    name: '척후 기병',
    age: 1,
    producedAt: 'stables',
    cost: { gold: 55, wood: 15, mana: 0 },
    trainTime: 20,
    pop: 1,
    hp: 120,
    armor: 'light',
    speed: 4.2,
    radius: 0.38,
    attack: { damage: 8, type: 'normal', range: 1, cooldown: 1.2 },
    tags: ['cavalry'],
    bonusVsBuilding: { obelisk: 3, farmstead: 3 },
  },
  knight: {
    id: 'knight',
    name: '기사',
    age: 2,
    producedAt: 'stables',
    cost: { gold: 90, wood: 40, mana: 0 },
    trainTime: 28,
    pop: 2,
    hp: 260,
    armor: 'heavy',
    speed: 3.6,
    radius: 0.4,
    attack: { damage: 18, type: 'normal', range: 1, cooldown: 1.4 },
    tags: ['cavalry'],
  },
  royal_guard: {
    id: 'royal_guard',
    name: '왕실 근위병',
    age: 2,
    producedAt: 'barracks',
    cost: { gold: 70, wood: 20, mana: 0 },
    trainTime: 26,
    pop: 2,
    hp: 240,
    armor: 'heavy',
    speed: 2.1,
    radius: 0.36,
    attack: { damage: 14, type: 'normal', range: 1, cooldown: 1.3 },
    ability: 'shieldWall',
  },
  battlemage: {
    id: 'battlemage',
    name: '전투 마법사',
    age: 2,
    producedAt: 'mage_tower',
    cost: { gold: 60, wood: 30, mana: 60 },
    trainTime: 30,
    pop: 2,
    hp: 90,
    armor: 'light',
    speed: 2.2,
    radius: 0.3,
    attack: { damage: 20, type: 'magic', range: 5, cooldown: 2.0, splash: 1.2 },
  },

  // ---------- 맹세의 궁극 유닛 (왕국 시대, 맹세의 성소) ----------
  // 한 경기에 한 기만 존재한다. oath가 맞는 플레이어만 뽑을 수 있다.

  solarion: {
    id: 'solarion',
    name: '솔라리온',
    title: '새벽의 성기사왕',
    age: 3,
    producedAt: 'sanctum',
    oath: 'crown',
    ultimate: true,
    cost: { gold: 800, wood: 300, mana: 400 },
    trainTime: 90,
    pop: 6,
    hp: 1800,
    armor: 'heavy',
    speed: 3.0,
    radius: 0.55,
    attack: { damage: 60, type: 'normal', range: 1, cooldown: 1.2 },
    tags: ['cavalry'],
    bonusVsArmor: { colossal: 3 }, // 거인 사냥꾼
    abilities: ['dawnCharge'],
    aura: { radius: 6, damage: 1.2, resist: 0.85 }, // 새벽의 오라
    revive: { delay: 60, cost: { gold: 300, wood: 0, mana: 0 } }, // 불멸의 맹세
  },
  etheria: {
    id: 'etheria',
    name: '에테리아',
    title: '별을 엮는 대마법사',
    age: 3,
    producedAt: 'sanctum',
    oath: 'rune',
    ultimate: true,
    cost: { gold: 400, wood: 200, mana: 900 },
    trainTime: 90,
    pop: 6,
    hp: 900,
    armor: 'light',
    speed: 2.2,
    radius: 0.42,
    attack: { damage: 40, type: 'magic', range: 7, cooldown: 1.8, chain: { targets: 3, falloff: 0.25 } },
    abilities: ['starfall', 'timeWard'],
    manaResonance: { perObelisk: 0.1, max: 0.4 }, // 마나 샘 1곳당 재사용 대기시간 -10%
  },
  arkanon: {
    id: 'arkanon',
    name: '아르카논',
    title: '성채를 짊어진 신수',
    age: 3,
    producedAt: 'sanctum',
    oath: 'earth',
    ultimate: true,
    cost: { gold: 600, wood: 600, mana: 600 },
    trainTime: 120,
    pop: 10,
    hp: 5000,
    armor: 'colossal',
    speed: 1.4,
    radius: 0.7,
    attack: { damage: 70, type: 'normal', range: 1.5, cooldown: 2.2, splash: 2 },
    abilities: ['root', 'unload'],
    garrison: true, // 등 위의 성채
  },
});

/** 궁극 유닛인지 */
export const isUltimate = (type) => Boolean(UNITS[type]?.ultimate);

/** 왕실 근위병의 방패벽: 켜면 느려지는 대신 화살(관통 피해)에 강해진다 */
export const SHIELD_WALL = Object.freeze({ speedMultiplier: 0.5, pierceTakenMultiplier: 0.4 });

/** 농노의 채집 능력 */
export const WORKER = Object.freeze({
  carryCapacity: 10,
  gatherRate: { gold: 1.25, wood: 1.0 },
});

/** 스냅샷에서 유닛 종류를 숫자로 보낼 때 쓰는 순서. 순서를 바꾸면 서버와 클라이언트를 함께 배포해야 한다. */
export const UNIT_TYPES = Object.freeze(Object.keys(UNITS));
