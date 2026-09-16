// 유닛 능력 — docs/GAME_DESIGN.md 3·4장
// kind: toggle(켜고 끄기) · point(땅을 찍어 쓴다) · instant(바로 쓴다)
// 서버가 판정하고, 클라이언트는 명령 카드와 효과 표시에 쓴다.

export const ABILITIES = Object.freeze({
  shieldWall: Object.freeze({
    id: 'shieldWall',
    name: '방패벽',
    kind: 'toggle',
    hotkey: 'F',
    desc: '이동 속도 절반, 관통 피해 60% 감소',
  }),
  dawnCharge: Object.freeze({
    id: 'dawnCharge',
    name: '여명 돌격',
    kind: 'point',
    hotkey: 'F',
    cooldown: 20,
    range: 8,
    directional: true, // 찍은 지점이 아니라 그 '방향'으로 8타일 돌진한다
    halfWidth: 0.9,
    damage: 120,
    damageType: 'normal',
    stun: 1.5,
    desc: '8타일 돌진 · 경로의 적에게 120 피해와 1.5초 기절',
  }),
  starfall: Object.freeze({
    id: 'starfall',
    name: '성좌 붕괴',
    kind: 'point',
    hotkey: 'F',
    cooldown: 45,
    range: 7,
    channel: 2.5,
    radius: 4,
    damage: 350,
    damageType: 'magic',
    desc: '2.5초 영창 뒤 반경 4타일에 마법 350 · 움직이거나 기절하면 취소',
  }),
  timeWard: Object.freeze({
    id: 'timeWard',
    name: '시간의 결계',
    kind: 'point',
    hotkey: 'G',
    cooldown: 30,
    range: 6,
    radius: 5,
    slow: 0.4,
    duration: 6,
    desc: '반경 5타일 적의 이동·공격 속도 40% 감소, 6초',
  }),
  root: Object.freeze({
    id: 'root',
    name: '뿌리내리기',
    kind: 'toggle',
    hotkey: 'F',
    unrootTime: 5, // 뿌리내리는 건 즉시, 뽑는 데 5초
    damageTaken: 0.7,
    popCap: 10,
    trains: ['pikeman', 'longbowman'],
    desc: '이동 불가 · 받는 피해 30% 감소 · 인구 +10 · 창병·장궁병 생산 (해제 5초)',
  }),
  unload: Object.freeze({
    id: 'unload',
    name: '내리기',
    kind: 'instant',
    hotkey: 'G',
    desc: '등에 태운 유닛을 모두 내린다',
  }),
});

/** 스냅샷에서 능력을 숫자로 보낼 때 쓰는 순서 */
export const ABILITY_IDS = Object.freeze(Object.keys(ABILITIES));

/** 등 위의 성채 (아르카논) */
export const GARRISON = Object.freeze({
  capacity: 6,
  allow: Object.freeze(['pikeman', 'longbowman', 'royal_guard', 'battlemage']),
  rangeBonus: 2, // 등 위의 원거리 유닛은 사거리가 이만큼 늘어난다
  boardRange: 1.6, // 이 거리 안에 오면 올라탄다
});
