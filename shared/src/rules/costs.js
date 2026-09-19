import { RESOURCES } from '../data/economy.js';
import { BUILDINGS, SELL_REFUND } from '../data/buildings.js';

/** 비용을 치르기에 모자란 첫 자원 이름. 충분하면 null (서버의 자원은 소수일 수 있어 내림해서 비교한다) */
export function missingResource(stock, cost) {
  for (const resource of RESOURCES) {
    if ((cost[resource] ?? 0) > Math.floor(stock[resource])) return resource;
  }
  return null;
}

/** 팔 수 있는 건물인가 (영주관은 못 판다) */
export const canSell = (type) => Boolean(BUILDINGS[type]) && !BUILDINGS[type].unique;

/** 건물을 팔면 돌려받는 자원: 비용의 절반 × 남은 체력 비율 (내림) */
export function sellRefund(type, hpRatio) {
  const cost = BUILDINGS[type].cost;
  const ratio = SELL_REFUND * Math.max(0, Math.min(1, hpRatio));
  return Object.fromEntries(RESOURCES.map((resource) => [resource, Math.floor((cost[resource] ?? 0) * ratio)]));
}
