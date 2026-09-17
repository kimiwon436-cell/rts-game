import { SHIELD_WALL, UNITS } from '@rune/shared/data/units.js';
import { lineOfSight } from '../pathfinding/astar.js';
import { canMove, slowFactor } from './abilities.js';

/** 한 틱에 계산할 경로 요청의 최대 개수와 시간 (docs/ARCHITECTURE.md 6장) */
export const PATH_BUDGET = Object.freeze({ count: 24, ms: 8 });

/** 이동 명령인데 이만큼(틱) 목적지에 가까워지지 못했고 이미 목적지 근처라면 도착으로 친다 */
const STUCK_TICKS = 20;
const STUCK_ARRIVE_DISTANCE = 1.6;
/** 중간 웨이포인트는 이만큼(타일) 가까이 가면 지나간 것으로 친다 (마지막 웨이포인트는 정확히) */
const WAYPOINT_SLACK = 0.45;

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
      // 두 유닛이 같은 중간 지점을 동시에 지나가려 하면 서로 밀어 중심이 딱 맞는 순간이 오지 않는다.
      // 중간 지점은 가까이만 가면 지나간 것으로 치고 다음 지점으로 간다.
      if (unit.path.length > 1 && distance < WAYPOINT_SLACK) {
        unit.path.shift();
        continue;
      }
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
    if (unit.path && isStuck(unit)) {
      if (unit.path.length > 1) {
        unit.path.shift(); // 중간 지점에서 막혔다: 건너뛰고 다음 지점으로
        unit.stuck = null;
      } else if (travelOrder && remainingDistance(unit) <= STUCK_ARRIVE_DISTANCE) {
        unit.path = null; // 무리의 마지막 자리를 이웃이 막고 있다: 이 정도면 도착이다
      }
    }
    if (!unit.path && !unit.pathPending && travelOrder) world.stopUnit(unit);
  }
}

function remainingDistance(unit) {
  const [ex, ey] = unit.path[unit.path.length - 1];
  return Math.hypot(ex - unit.x, ey - unit.y);
}

/**
 * 1초 동안 목적지에 가까워지지 못했는가.
 * (밀어내기가 매 틱 같은 만큼 되돌려 놓으면 경로가 남은 채로 영원히 '이동 중'에 머문다)
 */
function isStuck(unit) {
  const remaining = remainingDistance(unit);
  const stuck = unit.stuck;
  if (stuck?.path !== unit.path || remaining < stuck.best - 0.05) {
    // 가까워지는 동안은 매 틱 여기로 온다: 객체를 새로 만들지 않고 고쳐 쓴다
    if (stuck) {
      stuck.path = unit.path;
      stuck.best = remaining;
      stuck.ticks = 0;
    } else {
      unit.stuck = { path: unit.path, best: remaining, ticks: 0 };
    }
    return false;
  }
  stuck.ticks += 1;
  return stuck.ticks >= STUCK_TICKS;
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
