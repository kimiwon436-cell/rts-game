import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { garrisonOf } from '@rune/shared/rules/garrison.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { attackReach, computeDamage, isMelee } from '@rune/shared/rules/combat.js';
import { lineOfSight } from '../pathfinding/astar.js';
import { distanceToRect } from '../World.js';
import { canAct, canMove, damageDealtMultiplier, damageTakenMultiplier, slowFactor } from './abilities.js';
import { revealAttacker } from './vision.js';
import { UnitGrid } from '../spatial.js';

const ACQUIRE_EVERY_TICKS = 4; // 0.2초마다 주변 적을 찾는다 (유닛마다 틱을 엇갈려서)
const MELEE_ACQUIRE_RANGE = 5; // 근접 유닛이 스스로 싸우러 가는 거리 (타일)
const RANGED_ACQUIRE_EXTRA = 2; // 원거리 유닛은 사거리 + 이만큼
const LEASH_EXTRA = 4; // 스스로 고른 적이 이만큼 더 멀어지면 쫓기를 포기한다
const CHASE_REPATH_TICKS = 10; // 쫓아갈 때 0.5초마다 경로를 새로 잡는다
const WORKER_TARGET_PENALTY = 2; // 싸울 수 있는 유닛을 농노보다 먼저 노린다
const BUILDING_TARGET_PENALTY = 3; // 유닛을 건물보다 먼저 노린다
const CHAIN_RANGE = 4; // 연쇄 번개가 튕기는 거리 (타일)
const SHORE_SEARCH = 8; // 물과 뭍 사이로 쫓을 때 목표에서 이만큼 안의 내 쪽 칸(물가)으로 간다
const GRID_CELL = 4; // 표적 찾기용 공간 색인 한 칸 (타일)
const MAX_UNIT_RADIUS = Math.max(...Object.values(UNITS).map((def) => def.radius));

/** 유닛 종류끼리 피해를 줄 수 있는가 (배율이 0인 조합만 못 준다. 방패벽은 줄일 뿐이다) */
const CAN_DAMAGE = Object.fromEntries(
  Object.entries(UNITS).map(([type, def]) => [
    type,
    Object.fromEntries(Object.entries(UNITS).map(([other, otherDef]) => [other, computeDamage(def, { def: otherDef }) > 0])),
  ]),
);

const isUnit = (entity) => UNITS[entity.type] !== undefined;
const acquireRange = (attack) => (isMelee(attack) ? MELEE_ACQUIRE_RANGE : attack.range + RANGED_ACQUIRE_EXTRA);
const targetInfo = (entity) =>
  isUnit(entity) ? { def: UNITS[entity.type], shieldWall: entity.shieldWall } : { building: true, type: entity.type };
// 적 = 다른 팀. 등에 탄 유닛은 때릴 수 없다 (피해 면역)
const isEnemyAlive = (world, entity, owner) =>
  Boolean(entity) && entity.hp > 0 && world.areEnemies(entity.owner, owner) && !entity.carrierId;

/** 등 위의 원거리 유닛은 사거리가 늘어난다 (아르카논 +2, 수송선은 0) */
const rangeBonus = (world, unit) => (unit.carrierId ? (garrisonOf(world.units.get(unit.carrierId)?.type)?.rangeBonus ?? 0) : 0);

/** 태운 쪽 위에서 싸울 수 있는가: 태운 쪽이 허락하고(아르카논) 원거리 유닛일 때만. 수송선 안에서는 싸우지 않는다 */
function canFightAboard(world, unit, def) {
  const carrier = world.units.get(unit.carrierId);
  return Boolean(carrier && garrisonOf(carrier.type)?.ridersFight) && !isMelee(def.attack);
}

/** 물 위에 있는 대상인가 (배). 건물은 모두 뭍에 있다 */
const onWater = (entity) => isUnit(entity) && Boolean(UNITS[entity.type].naval);

/** 유닛 몸과 대상(유닛 몸 또는 건물 사각형)의 가장자리 사이 거리 */
export function gapBetween(unit, target) {
  const radius = UNITS[unit.type].radius;
  if (isUnit(target)) return Math.hypot(target.x - unit.x, target.y - unit.y) - radius - UNITS[target.type].radius;
  return distanceToRect(unit.x, unit.y, target) - radius;
}

/**
 * 전투: 공격 명령·공격 이동·대기 중인 병력의 적 찾기, 사거리까지 쫓기, 공격, 범위 피해, 감시탑.
 * 죽은 유닛·건물은 이 다음 cleanup에서 치운다.
 * 전장의 안개: 스스로는 우리 팀에게 보이는 적만 노린다. 공격 명령으로 쫓던 유닛이 안개 속으로 사라지면
 * 마지막으로 본 곳까지 공격 이동으로 간다. 범위·연쇄 피해는 보이든 말든 그 자리의 적에게 들어간다.
 */
export function updateCombat(world, dt) {
  // 전투 중에는 아무도 자리를 옮기지 않으니 틱 한 번 색인을 만들어 표적 찾기·범위 피해에 쓴다
  const units = world.scratchUnits;
  units.length = 0;
  for (const unit of world.units.values()) units.push(unit);
  world.combatGrid ??= new UnitGrid(world.width, world.height, GRID_CELL);
  world.combatGrid.build(units);

  for (const unit of world.units.values()) {
    const def = UNITS[unit.type];
    if (!def.attack) continue; // 싸우지 않는 유닛 (수송선)
    if (unit.cooldown > 0) unit.cooldown = Math.max(0, unit.cooldown - dt);
    if (!canAct(world, unit)) continue; // 기절·영창·뿌리내리는 중에는 싸우지 않는다
    if (unit.carrierId && !canFightAboard(world, unit, def)) continue; // 등 위에서는 원거리 공격만, 수송선 안에서는 못 싸운다
    const target = chooseTarget(world, unit);
    if (target) engage(world, unit, target);
  }
  for (const building of world.buildings.values()) {
    if (BUILDINGS[building.type].attack && building.complete) updateTower(world, building, dt);
  }
}

// ---------- 유닛 ----------

function chooseTarget(world, unit) {
  const def = UNITS[unit.type];
  const order = unit.order;
  const team = world.teamOf(unit.owner);

  if (order?.type === 'attack') {
    const target = world.entity(order.targetId);
    if (isEnemyAlive(world, target, unit.owner)) {
      if (isUnit(target)) {
        if (!world.isVisibleTo(team, target)) {
          chaseIntoFog(world, unit, order);
          return null;
        }
        order.lastX = target.x;
        order.lastY = target.y;
      }
      unit.combatTargetId = target.id;
      return target;
    }
    world.stopUnit(unit); // 목표가 쓰러졌다
    return null;
  }

  let target = unit.combatTargetId != null ? world.entity(unit.combatTargetId) : null;
  if (!isEnemyAlive(world, target, unit.owner) || !world.isVisibleTo(team, target)) target = null;
  const seekRange = acquireRange(def.attack) + rangeBonus(world, unit);
  if (target && unit.autoTarget && gapBetween(unit, target) > seekRange + LEASH_EXTRA) target = null;
  if (!target && unit.combatTargetId != null) disengage(world, unit);

  const seeksFight = !def.worker && (!unit.order || unit.order.type === 'attackMove');
  if (!target && seeksFight && (world.tick + unit.id) % ACQUIRE_EVERY_TICKS === 0) {
    target = findEnemy(world, unit, def);
    if (target) {
      unit.combatTargetId = target.id;
      unit.autoTarget = true;
    }
  }
  return target;
}

/** 쫓던 적이 안개 속으로 사라졌다: 마지막으로 본 곳까지 공격 이동으로 간다 (그곳에서 보이는 적과 다시 싸운다) */
function chaseIntoFog(world, unit, order) {
  const { lastX, lastY } = order;
  world.stopUnit(unit);
  if (lastX === undefined) return;
  const goal = { rect: { x: Math.floor(lastX), y: Math.floor(lastY), w: 1, h: 1 }, adjacent: false, point: { x: lastX, y: lastY } };
  unit.order = { type: 'attackMove', goal };
  unit.state = UNIT_STATE.MOVE;
  world.requestPath(unit, goal);
}

/** 싸우던 적이 사라졌다: 공격 이동 중이면 목적지로 다시 가고, 아니면 그 자리에 선다 */
function disengage(world, unit) {
  unit.combatTargetId = null;
  unit.autoTarget = false;
  unit.path = null;
  if (unit.order?.type === 'attackMove') {
    unit.state = UNIT_STATE.MOVE;
    world.requestPath(unit, unit.order.goal);
  } else if (!unit.order) {
    unit.state = UNIT_STATE.IDLE;
  }
}

function findEnemy(world, unit, def) {
  const range = acquireRange(def.attack) + rangeBonus(world, unit);
  const team = world.teamOf(unit.owner);
  const { vision } = world;

  // 나를 때린 적이 쫓을 만한 거리에 있으면 먼저 반격한다 (때린 적은 잠깐 드러나 있다)
  const attacker = unit.lastAttackerId != null ? world.entity(unit.lastAttackerId) : null;
  if (
    isEnemyAlive(world, attacker, unit.owner) &&
    world.isVisibleTo(team, attacker) &&
    gapBetween(unit, attacker) <= range + LEASH_EXTRA &&
    computeDamage(def, targetInfo(attacker)) > 0
  ) {
    return attacker;
  }

  let best = null;
  let bestScore = Infinity;
  const reach = range + 1;
  const grid = world.combatGrid;
  const { cols, starts, items } = grid;
  const canDamage = CAN_DAMAGE[unit.type];
  const col0 = grid.col(unit.x - reach);
  const col1 = grid.col(unit.x + reach);
  for (let row = grid.row(unit.y - reach), row1 = grid.row(unit.y + reach); row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const cell = row * cols + col;
      for (let i = starts[cell]; i < starts[cell + 1]; i++) {
        const other = items[i];
        if (!world.areEnemies(other.owner, unit.owner) || other.carrierId) continue;
        if (Math.abs(other.x - unit.x) > reach || Math.abs(other.y - unit.y) > reach) continue;
        if (!vision.isVisible(team, other.x, other.y)) continue; // 안개 속의 적은 스스로 노리지 않는다
        const gap = gapBetween(unit, other);
        if (gap > range || !canDamage[other.type]) continue;
        const score = gap + (UNITS[other.type].worker ? WORKER_TARGET_PENALTY : 0);
        // 점수가 같으면 id가 작은 쪽: 칸을 훑는 순서와 상관없이 늘 같은 적을 고른다
        if (score < bestScore || (score === bestScore && other.id < best.id)) {
          bestScore = score;
          best = other;
        }
      }
    }
  }
  for (const building of world.buildings.values()) {
    if (!world.areEnemies(building.owner, unit.owner)) continue;
    if (
      building.x > unit.x + reach ||
      building.x + building.w < unit.x - reach ||
      building.y > unit.y + reach ||
      building.y + building.h < unit.y - reach
    ) {
      continue; // 한참 먼 건물은 거리 계산 없이 건너뛴다
    }
    const gap = gapBetween(unit, building);
    if (gap > range || !vision.isRectVisible(team, building)) continue;
    const score = gap + BUILDING_TARGET_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      best = building;
    }
  }
  return best;
}

function engage(world, unit, target) {
  const def = UNITS[unit.type];
  unit.state = UNIT_STATE.ATTACK;

  if (gapBetween(unit, target) <= attackReach(def.attack) + rangeBonus(world, unit)) {
    unit.path = null;
    unit.pathPending = false;
    if (unit.cooldown <= 0) {
      strike(world, unit, def, target);
      unit.cooldown = def.attack.cooldown / slowFactor(world, unit); // 둔화는 공격 속도도 늦춘다
    }
    return;
  }

  if (unit.carrierId || !canMove(world, unit)) return; // 등 위나 뿌리내린 채로는 쫓아가지 않는다

  if ((!unit.path && !unit.pathPending) || world.tick - unit.chaseTick >= CHASE_REPATH_TICKS) {
    unit.chaseTick = world.tick;
    chase(world, unit, def, target);
  }
}

function chase(world, unit, def, target) {
  const nav = world.navOf(unit);
  if (Boolean(def.naval) !== onWater(target)) {
    // 배가 뭍의 적을, 뭍의 원거리 유닛이 배를 쫓는다: 목표에서 가장 가까운 내 쪽 칸(물가)까지만 간다
    const cx = isUnit(target) ? target.x : target.x + target.w / 2;
    const cy = isUnit(target) ? target.y : target.y + target.h / 2;
    const spot = world.nearestFreeTile(cx, cy, SHORE_SEARCH, nav);
    if (!spot) {
      if (unit.order?.type === 'attack') world.stopUnit(unit); // 닿을 수 없는 적
      return;
    }
    world.moveUnit(unit, { x: spot[0], y: spot[1], w: 1, h: 1 }, false);
    return;
  }
  if (!isUnit(target)) {
    world.moveUnit(unit, target, true);
    return;
  }
  const tile = { x: Math.floor(target.x), y: Math.floor(target.y), w: 1, h: 1 };
  // 곧장 보이면 적의 위치로 직선으로 다가간다 (칸 경로는 적 칸 옆 칸에서 멈춰 근접 공격이 안 닿을 수 있다)
  if (lineOfSight(nav, unit.x, unit.y, target.x, target.y, def.radius)) {
    unit.path = [[target.x, target.y]];
    unit.pathPending = false;
    unit.goal = { rect: tile, adjacent: true, point: null };
    unit.navVersion = nav.version;
    return;
  }
  world.moveUnit(unit, tile, true);
}

// ---------- 공격과 피해 ----------

function strike(world, attacker, def, target) {
  world.events.push([GAME_EVENT.ATTACK, attacker.id, target.id]);
  if (def.attack.chain) {
    chainStrike(world, attacker, def, target, def.attack.chain);
    return;
  }
  const splash = def.attack.splash;
  if (!splash) {
    hit(world, attacker, def, target);
    return;
  }
  const cx = isUnit(target) ? target.x : target.x + target.w / 2;
  const cy = isUnit(target) ? target.y : target.y + target.h / 2;
  // 범위 안의 모든 적 (맞는 순서는 결과에 영향이 없다)
  forUnitsNear(world, cx, cy, splash + MAX_UNIT_RADIUS, (unit) => {
    if (world.areEnemies(unit.owner, attacker.owner) && Math.hypot(unit.x - cx, unit.y - cy) <= splash + UNITS[unit.type].radius) {
      hit(world, attacker, def, unit);
    }
  });
  for (const building of world.buildings.values()) {
    if (world.areEnemies(building.owner, attacker.owner) && distanceToRect(cx, cy, building) <= splash) {
      hit(world, attacker, def, building);
    }
  }
}

/** 연쇄 번개: 가까운 적으로 튕기며 튈 때마다 피해가 준다 (에테리아) */
function chainStrike(world, attacker, def, target, chain) {
  const struck = new Set();
  let current = target;
  let scale = 1;

  for (let i = 0; i < chain.targets && current; i++) {
    hit(world, attacker, def, current, scale);
    struck.add(current.id);
    scale *= 1 - chain.falloff;

    const from = current;
    let next = null;
    let best = CHAIN_RANGE;
    forUnitsNear(world, from.x, from.y, CHAIN_RANGE, (other) => {
      if (!world.areEnemies(other.owner, attacker.owner) || struck.has(other.id) || other.carrierId || other.hp <= 0) return;
      const d = Math.hypot(other.x - from.x, other.y - from.y);
      // 가장 가까운 적. 거리가 같으면 id가 큰 쪽 (예전처럼 id 순서로 훑으며 '같거나 가까우면' 바꾼 결과와 같다)
      if (d < best || (d === best && (!next || other.id > next.id))) {
        best = d;
        next = other;
      }
    });
    current = next;
    if (current) world.events.push([GAME_EVENT.ATTACK, attacker.id, current.id]);
  }
}

function hit(world, attacker, def, target, scale = 1) {
  if (target.hp <= 0 || target.carrierId) return;
  const damage =
    computeDamage(def, targetInfo(target)) * scale * damageDealtMultiplier(attacker) * damageTakenMultiplier(target);
  if (damage <= 0) return;
  target.hp -= damage;
  if (isUnit(target)) target.lastAttackerId = attacker.id;
  revealAttacker(world, attacker, target);
}

/** (x, y)에서 radius 안쪽 칸에 든 유닛마다 visit (공간 색인으로 훑는다) */
function forUnitsNear(world, x, y, radius, visit) {
  const grid = world.combatGrid;
  const { cols, starts, items } = grid;
  const col0 = grid.col(x - radius);
  const col1 = grid.col(x + radius);
  for (let row = grid.row(y - radius), row1 = grid.row(y + radius); row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const cell = row * cols + col;
      for (let i = starts[cell]; i < starts[cell + 1]; i++) visit(items[i]);
    }
  }
}

// ---------- 감시탑 ----------

const towerGap = (building, unit) => distanceToRect(unit.x, unit.y, building) - UNITS[unit.type].radius;

function updateTower(world, building, dt) {
  const def = BUILDINGS[building.type];
  if (building.cooldown > 0) building.cooldown = Math.max(0, building.cooldown - dt);
  const team = world.teamOf(building.owner);
  const { vision } = world;

  let target = building.combatTargetId != null ? world.units.get(building.combatTargetId) : null;
  if (
    !isEnemyAlive(world, target, building.owner) ||
    towerGap(building, target) > def.attack.range ||
    !vision.isVisible(team, target.x, target.y)
  ) {
    target = null;
  }
  if (!target && (world.tick + building.id) % ACQUIRE_EVERY_TICKS === 0) {
    let bestScore = Infinity;
    const cx = building.x + building.w / 2;
    const cy = building.y + building.h / 2;
    const reach = def.attack.range + Math.max(building.w, building.h) / 2 + MAX_UNIT_RADIUS;
    forUnitsNear(world, cx, cy, reach, (unit) => {
      if (!world.areEnemies(unit.owner, building.owner) || unit.carrierId) return;
      const gap = towerGap(building, unit);
      if (gap > def.attack.range || !vision.isVisible(team, unit.x, unit.y)) return;
      const score = gap + (UNITS[unit.type].worker ? WORKER_TARGET_PENALTY : 0);
      if (score < bestScore || (score === bestScore && unit.id < target.id)) {
        bestScore = score;
        target = unit;
      }
    });
  }
  building.combatTargetId = target?.id ?? null;
  if (target && building.cooldown <= 0) {
    strike(world, building, def, target);
    building.cooldown = def.attack.cooldown;
  }
}
