import { SHIELD_WALL, UNITS } from '@rune/shared/data/units.js';
import { lineOfSight } from '../pathfinding/astar.js';
import { canMove, slowFactor } from './abilities.js';

/** 한 틱에 계산할 경로 요청의 최대 개수와 시간 (docs/ARCHITECTURE.md 6장) */
export const PATH_BUDGET = Object.freeze({ count: 24, ms: 8 });

/**
 * 경로 요청을 예산만큼 처리하고, 경로가 있는 유닛을 웨이포인트를 따라 움직인다.
 * 칸이 새로 막혔을 때는 남은 경로가 실제로 막힌 유닛만 경로를 다시 찾는다.
 */
export function updateMovement(world, dt) {
  world.processPathQueue(PATH_BUDGET.count, PATH_BUDGET.ms);

  for (const unit of world.units.values()) {
    if (!unit.path) continue;
    if (!canMove(world, unit)) continue; // 기절·영창·뿌리내림
    const def = UNITS[unit.type];

    if (unit.navVersion !== world.nav.version) {
      unit.navVersion = world.nav.version;
      if (pathBlocked(world.nav, unit, def.radius * 0.5)) repath(world, unit);
    }

    let step = def.speed * (unit.shieldWall ? SHIELD_WALL.speedMultiplier : 1) * slowFactor(world, unit) * dt;
    while (step > 0 && unit.path) {
      const [wx, wy] = unit.path[0];
      const dx = wx - unit.x;
      const dy = wy - unit.y;
      const distance = Math.hypot(dx, dy);
      const travel = Math.min(step, distance);
      const nx = distance > 0 ? unit.x + (dx / distance) * travel : wx;
      const ny = distance > 0 ? unit.y + (dy / distance) * travel : wy;

      if (world.nav.isBlocked(Math.floor(nx), Math.floor(ny))) {
        // 옆 유닛에게 밀려 벽 모서리에 걸렸다: 칸 중심으로 돌아가 경로를 다시 찾는다
        recoverFromCorner(world, unit);
        break;
      }
      unit.x = nx;
      unit.y = ny;
      step -= travel;
      if (travel === distance) {
        unit.path.shift();
        if (unit.path.length === 0) unit.path = null;
      }
    }

    // 이동·공격 이동은 목적지에 도착하면 끝난다 (채집·건설·공격은 각 시스템이 도착을 처리한다)
    const travelOrder = unit.order?.type === 'move' || (unit.order?.type === 'attackMove' && unit.combatTargetId == null);
    if (!unit.path && !unit.pathPending && travelOrder) world.stopUnit(unit);
  }
}

function pathBlocked(nav, unit, radius) {
  let ax = unit.x;
  let ay = unit.y;
  for (const [bx, by] of unit.path) {
    if (!lineOfSight(nav, ax, ay, bx, by, radius)) return true;
    ax = bx;
    ay = by;
  }
  return false;
}

function repath(world, unit) {
  if (!unit.goal) return;
  const { rect, adjacent, point } = unit.goal;
  world.moveUnit(unit, rect, adjacent, point);
}

function recoverFromCorner(world, unit) {
  const tx = Math.floor(unit.x);
  const ty = Math.floor(unit.y);
  if (!world.nav.isBlocked(tx, ty)) {
    unit.x = tx + 0.5;
    unit.y = ty + 0.5;
  }
  repath(world, unit);
}
