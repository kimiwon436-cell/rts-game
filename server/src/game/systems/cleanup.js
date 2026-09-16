import { UNITS } from '@rune/shared/data/units.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';
import { onUltimateDied } from './abilities.js';

/**
 * 체력이 다한 유닛과 건물을 없앤다.
 * 그 건물을 짓던 농노나 그것을 노리던 유닛은 각자의 시스템에서 대상이 사라진 것을 보고 멈춘다.
 */
export function removeDead(world) {
  for (const unit of world.units.values()) {
    if (unit.hp > 0) continue;
    if (UNITS[unit.type].ultimate) onUltimateDied(world, unit); // 부활 예약·탑승 유닛 내리기
    world.units.delete(unit.id);
    world.events.push([GAME_EVENT.UNIT_DIED, unit.id]);
  }
  for (const building of world.buildings.values()) {
    if (building.hp > 0) continue;
    world.removeBuilding(building);
    world.events.push([GAME_EVENT.BUILDING_DESTROYED, building.id]);
  }
}
