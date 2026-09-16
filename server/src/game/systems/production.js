import { UNITS } from '@rune/shared/data/units.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { orderGather } from './gathering.js';

/**
 * 완성된 건물의 생산 대기열 맨 앞을 진행한다.
 * 다 만들었는데 인구 상한이 모자라면 100%에서 멈춰 기다린다 (농가를 지으면 바로 나온다).
 */
export function updateProduction(world, dt) {
  for (const building of world.buildings.values()) {
    if (!building.complete || building.queue.length === 0) continue;

    const item = building.queue[0];
    const def = UNITS[item.type];
    if (item.progress < 1) {
      item.progress = Math.min(1, item.progress + dt / def.trainTime);
      if (item.progress < 1) continue;
    }

    const player = world.players[building.owner];
    if (player.pop + def.pop > player.popCap) {
      item.blocked = true;
      continue;
    }

    building.queue.shift();
    const toward = building.rally ?? { x: world.width / 2, y: world.height / 2 };
    const unit = world.spawnUnitNear(item.type, building.owner, building, toward);
    player.pop += def.pop;
    world.events.push([GAME_EVENT.TRAINED, unit.id, building.owner]);
    sendToRally(world, building, unit);
  }
}

/** 새 유닛을 집결지로 보낸다. 집결지가 금광·나무이고 농노면 바로 채집한다. */
function sendToRally(world, building, unit) {
  const rally = building.rally;
  if (!rally) return;

  if (UNITS[unit.type].worker && (rally.mineId || rally.tile != null)) {
    const target = rally.mineId ? { mineId: rally.mineId } : { tile: rally.tile };
    if (orderGather(world, unit, target)) return;
  }

  unit.order = { type: 'move' };
  unit.state = UNIT_STATE.MOVE;
  world.requestPath(unit, {
    rect: { x: Math.floor(rally.x), y: Math.floor(rally.y), w: 1, h: 1 },
    adjacent: false,
    point: { x: rally.x, y: rally.y },
  });
}
