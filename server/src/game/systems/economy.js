import { AGES } from '@rune/shared/data/economy.js';
import { MARKET, TRADABLE, recoverPrice } from '@rune/shared/data/market.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';

/** 마나 생산, 시대 발전 진행, 시장 시세 회복, 인구 계산 */
export function updateEconomy(world, dt) {
  for (const building of world.buildings.values()) {
    if (!building.complete || !building.wellId) continue;
    const well = world.map.wells.find((w) => w.id === building.wellId);
    world.players[building.owner].mana += well.rate * dt;
  }

  for (const player of world.players) {
    if (!player) continue;

    if (player.ageTarget) {
      player.ageProgress = Math.min(1, player.ageProgress + dt / AGES[player.ageTarget].time);
      if (player.ageProgress >= 1) {
        player.age = player.ageTarget;
        player.ageTarget = 0;
        player.ageProgress = 0;
        world.events.push([GAME_EVENT.AGE_UP, player.slot, player.age]);
      }
    }

    for (const resource of TRADABLE) {
      player.market[resource] = recoverPrice(player.market[resource], MARKET.basePrice[resource], dt);
    }
  }

  world.updatePopulation();
}
