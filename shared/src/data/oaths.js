// 세 가지 맹세와 그 궁극 유닛 — docs/GAME_DESIGN.md 4장
// 왕국 시대에 맹세의 성소를 짓고 셋 중 하나를 고른다. 한 경기에 한 번, 번복할 수 없다.

export const OATHS = Object.freeze({
  crown: Object.freeze({
    id: 'crown',
    name: '왕관의 맹세',
    unit: 'solarion',
    color: '#f2c14e',
    summary: '새벽의 성기사왕 솔라리온. 혼자보다 군대와 함께일 때 강하다.',
    detail: '주변 아군을 강화하고, 거대 유닛을 사냥하며, 쓰러져도 영주관에서 다시 일어선다.',
  }),
  rune: Object.freeze({
    id: 'rune',
    name: '룬의 맹세',
    unit: 'etheria',
    color: '#8ea2ff',
    summary: '별을 엮는 대마법사 에테리아. 한 번의 영창이 전장을 지운다.',
    detail: '연쇄 번개로 여럿을 때리고, 성좌 붕괴와 시간의 결계로 판을 뒤집는다. 몸은 유리처럼 약하다.',
  }),
  earth: Object.freeze({
    id: 'earth',
    name: '대지의 맹세',
    unit: 'arkanon',
    color: '#7ec08a',
    summary: '성채를 짊어진 신수 아르카논. 멈춰 서는 곳이 곧 새 전선이 된다.',
    detail: '유닛 6기를 등에 태우고, 뿌리내리면 전진 기지가 되어 병력을 뽑는다.',
  }),
});

/** 스냅샷에서 맹세를 숫자로 보낼 때 쓰는 순서 */
export const OATH_IDS = Object.freeze(Object.keys(OATHS));

/** 궁극 유닛 상성: 솔라리온 › 아르카논 › 에테리아 › 솔라리온 */
export const OATH_COUNTER = Object.freeze({ crown: 'earth', earth: 'rune', rune: 'crown' });

export const oathOfUnit = (type) => Object.values(OATHS).find((oath) => oath.unit === type) ?? null;
