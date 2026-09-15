import { UNITS } from '@rune/shared/data/units.js';

/** 경로가 있는 유닛을 웨이포인트를 따라 움직인다. 칸이 새로 막혔으면 경로를 다시 찾는다. */
export function updateMovement(world, dt) {
  for (const unit of world.units.values()) {
    if (!unit.path) continue;

    if (unit.navVersion !== world.nav.version && unit.goal) {
      const { rect, adjacent, point } = unit.goal;
      world.moveUnit(unit, rect, adjacent, point);
    }

    let step = UNITS[unit.type].speed * dt;
    while (step > 0 && unit.path) {
      const [wx, wy] = unit.path[0];
      const dx = wx - unit.x;
      const dy = wy - unit.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= step) {
        unit.x = wx;
        unit.y = wy;
        step -= distance;
        unit.path.shift();
        if (unit.path.length === 0) unit.path = null;
      } else {
        unit.x += (dx / distance) * step;
        unit.y += (dy / distance) * step;
        step = 0;
      }
    }

    // 이동 명령은 도착하면 끝난다 (채집·건설은 각 시스템이 도착을 처리한다)
    if (!unit.path && unit.order?.type === 'move') world.stopUnit(unit);
  }
}
