import { SHIELD_WALL } from '../data/units.js';

// 피해 규칙 — docs/GAME_DESIGN.md 3-1장. 서버가 판정하고, 클라이언트는 명령 카드 설명에만 쓴다.

/** 피해 배율표: 공격 유형 × 방어 유형 */
export const DAMAGE_TABLE = Object.freeze({
  normal: Object.freeze({ light: 1.0, heavy: 0.8, air: 1.0, building: 0.4, colossal: 0.6 }),
  pierce: Object.freeze({ light: 1.25, heavy: 0.6, air: 2.0, building: 0.2, colossal: 0.5 }),
  magic: Object.freeze({ light: 1.0, heavy: 1.5, air: 1.0, building: 0.5, colossal: 0.25 }),
  siege: Object.freeze({ light: 0.6, heavy: 0.8, air: 0, building: 2.5, colossal: 2.0 }),
});

export const ATTACK_TYPE_NAMES = Object.freeze({ normal: '일반', pierce: '관통', magic: '마법', siege: '공성' });
export const ARMOR_NAMES = Object.freeze({ light: '경갑', heavy: '중갑', air: '비행', building: '건물', colossal: '거대' });

/** 사거리 1.5 이하는 근접 공격이다 */
export const isMelee = (attack) => attack.range <= 1.5;

/** 근접 공격은 몸과 몸 사이가 이 거리(타일) 안이면 닿는다 */
export const MELEE_REACH = 0.4;

/** 공격이 닿는 거리: 두 몸의 가장자리 사이 거리로 잰다 */
export const attackReach = (attack) => (isMelee(attack) ? MELEE_REACH : attack.range);

/**
 * 한 번 때릴 때의 피해. 0이면 그 대상을 공격할 수 없다.
 * 최종 피해 = max(1, 공격력 × 유형 배율 × 특수 보너스) — 대장간 업그레이드 배율은 이후 단계에서 곱한다
 *
 * @param {{ attack: object, bonusVsTag?: object, bonusVsBuilding?: object }} attacker UNITS[...] 또는 BUILDINGS[...]
 * @param {{ building: true, type: string } | { def: object, shieldWall?: boolean }} target
 */
export function computeDamage(attacker, target) {
  const { attack } = attacker;
  const armor = target.building ? 'building' : target.def.armor;
  const multiplier = DAMAGE_TABLE[attack.type][armor];
  if (!multiplier) return 0;
  if (armor === 'air' && isMelee(attack)) return 0; // 근접 공격은 하늘에 닿지 않는다

  let bonus = 1;
  if (target.building) {
    bonus *= attacker.bonusVsBuilding?.[target.type] ?? 1;
  } else if (attacker.bonusVsTag) {
    for (const tag of target.def.tags ?? []) bonus *= attacker.bonusVsTag[tag] ?? 1;
  }

  let damage = attack.damage * multiplier * bonus;
  if (target.shieldWall && attack.type === 'pierce') damage *= SHIELD_WALL.pierceTakenMultiplier;
  return Math.max(1, damage);
}
