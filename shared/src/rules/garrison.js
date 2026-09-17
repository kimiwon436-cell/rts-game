import { UNITS } from '../data/units.js';

/** 태울 수 있는 유닛이면 그 설정 { capacity, riders, rangeBonus, ridersFight, sinks }, 아니면 null */
export const garrisonOf = (type) => UNITS[type]?.garrison ?? null;

/** riderType이 carrierType에 탈 수 있는가. 배·하늘을 나는 유닛·궁극 유닛은 어디에도 타지 않는다 */
export function canBoard(carrierType, riderType) {
  const garrison = garrisonOf(carrierType);
  const rider = UNITS[riderType];
  if (!garrison || !rider || rider.naval || rider.flying || rider.ultimate) return false;
  return garrison.riders === 'land' || garrison.riders.includes(riderType);
}
