// 시장 교역 — docs/GAME_DESIGN.md 2장 "시장 교역"

export const MARKET = Object.freeze({
  lot: 100, // 한 번에 사고파는 양
  basePrice: Object.freeze({ wood: 100, mana: 250 }), // 100 단위의 금 시세
  buyMarkup: 1.15,
  sellMarkdown: 0.85,
  priceStep: 0.05, // 거래 한 번마다 시세 변화
  recoveryPerSec: 0.005, // 기준값 대비 초당 회복량
  minPrice: 20,
});

export const TRADABLE = Object.freeze(['wood', 'mana']);

/** 100 단위를 살 때 드는 금 */
export const buyCost = (price) => Math.round(price * MARKET.buyMarkup);

/** 100 단위를 팔 때 받는 금 */
export const sellGain = (price) => Math.round(price * MARKET.sellMarkdown);

/** 시세를 기준값 쪽으로 dt초만큼 되돌린다 */
export function recoverPrice(price, base, dt) {
  const step = base * MARKET.recoveryPerSec * dt;
  if (Math.abs(base - price) <= step) return base;
  return price + Math.sign(base - price) * step;
}
