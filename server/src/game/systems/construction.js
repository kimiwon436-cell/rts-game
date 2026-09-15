import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { RESOURCES, buildSpeedMultiplier } from '@rune/shared/data/economy.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { ADJACENT_DISTANCE, distanceToRect } from '../World.js';

// 건설 순환: toSite(부지로 이동) → building(짓기). 첫 농노가 도착하면 풋프린트가 막히고 공사가 시작된다.

/** 짓다 만 자기 건물로 가서 짓게 한다 */
export function orderConstruct(world, unit, building) {
  if (!building || building.complete || building.owner !== unit.owner) return false;
  unit.order = { type: 'construct', buildingId: building.id };
  unit.phase = 'toSite';
  unit.state = UNIT_STATE.MOVE;
  world.moveUnit(unit, building, true);
  return true;
}

export function updateConstruction(world, dt) {
  const builderCount = new Map();

  for (const unit of world.units.values()) {
    if (unit.order?.type !== 'construct') continue;
    const building = world.buildings.get(unit.order.buildingId);
    if (!building || building.complete) {
      world.stopUnit(unit);
      continue;
    }
    if (unit.phase === 'toSite') {
      if (unit.path) continue;
      if (distanceToRect(unit.x, unit.y, building) > ADJACENT_DISTANCE) {
        world.stopUnit(unit); // 부지에 닿을 수 없다
        continue;
      }
      unit.phase = 'building';
    }
    unit.state = UNIT_STATE.BUILD;
    builderCount.set(building.id, (builderCount.get(building.id) ?? 0) + 1);
  }

  for (const [buildingId, count] of builderCount) {
    const building = world.buildings.get(buildingId);
    if (!building.started) world.startConstruction(building);
    const def = BUILDINGS[building.type];
    const delta = Math.min(1 - building.progress, (dt / def.buildTime) * buildSpeedMultiplier(count));
    building.progress += delta;
    building.hp = Math.min(building.maxHp, building.hp + building.maxHp * 0.9 * delta);
    if (building.progress >= 1 - 1e-9) completeBuilding(world, building);
  }
}

function completeBuilding(world, building) {
  building.progress = 1;
  building.complete = true;
  building.hp = building.maxHp;
  world.events.push([GAME_EVENT.BUILT, building.id, building.owner]);
  stopBuilders(world, building);
}

/** 건설 취소: 짓지 않은 비율만큼 비용을 돌려준다 */
export function cancelConstruction(world, building) {
  const player = world.players[building.owner];
  const cost = BUILDINGS[building.type].cost;
  const refundRatio = 1 - building.progress;
  for (const resource of RESOURCES) player[resource] += Math.floor((cost[resource] ?? 0) * refundRatio);
  stopBuilders(world, building);
  world.removeBuilding(building);
}

function stopBuilders(world, building) {
  for (const unit of world.units.values()) {
    if (unit.order?.type === 'construct' && unit.order.buildingId === building.id) world.stopUnit(unit);
  }
}
