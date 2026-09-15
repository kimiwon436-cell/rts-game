import { RESOURCES } from '../data/economy.js';

/** 비용을 치르기에 모자란 첫 자원 이름. 충분하면 null (서버의 자원은 소수일 수 있어 내림해서 비교한다) */
export function missingResource(stock, cost) {
  for (const resource of RESOURCES) {
    if ((cost[resource] ?? 0) > Math.floor(stock[resource])) return resource;
  }
  return null;
}
