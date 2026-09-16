import { BUILDINGS } from '@rune/shared/data/buildings.js';
import { UNITS } from '@rune/shared/data/units.js';
import { GAME_EVENT, UNIT_STATE } from '@rune/shared/protocol.js';
import { attackReach, computeDamage, isMelee } from '@rune/shared/rules/combat.js';
import { lineOfSight } from '../pathfinding/astar.js';
import { distanceToRect } from '../World.js';

const ACQUIRE_EVERY_TICKS = 4; // 0.2초마다 주변 적을 찾는다 (유닛마다 틱을 엇갈려서)
const MELEE_ACQUIRE_RANGE = 5; // 근접 유닛이 스스로 싸우러 가는 거리 (타일)
const RANGED_ACQUIRE_EXTRA = 2; // 원거리 유닛은 사거리 + 이만큼
const LEASH_EXTRA = 4; // 스스로 고른 적이 이만큼 더 멀어지면 쫓기를 포기한다
const CHASE_REPATH_TICKS = 10; // 쫓아갈 때 0.5초마다 경로를 새로 잡는다
const WORKER_TARGET_PENALTY = 2; // 싸울 수 있는 유닛을 농노보다 먼저 노린다
const BUILDING_TARGET_PENALTY = 3; // 유닛을 건물보다 먼저 노린다

const isUnit = (entity) => UNITS[entity.type] !== undefined;
const acquireRange = (attack) => (isMelee(attack) ? MELEE_ACQUIRE_RANGE : attack.range + RANGED_ACQUIRE_EXTRA);
const targetInfo = (entity) =>
  isUnit(entity) ? { def: UNITS[entity.type], shieldWall: entity.shieldWall } : { building: true, type: entity.type };
const isEnemyAlive = (entity, owner) => Boolean(entity) && entity.hp > 0 && entity.owner !== owner;

/** 유닛 몸과 대상(유닛 몸 또는 건물 사각형)의 가장자리 사이 거리 */
export function gapBetween(unit, target) {
  const radius = UNITS[unit.type].radius;
  if (isUnit(target)) return Math.hypot(target.x - unit.x, target.y - unit.y) - radius - UNITS[target.type].radius;
  return distanceToRect(unit.x, unit.y, target) - radius;
}

/**
 * 전투: 공격 명령·공격 이동·대기 중인 병력의 적 찾기, 사거리까지 쫓기, 공격, 범위 피해, 감시탑.
 * 죽은 유닛·건물은 이 다음 cleanup에서 치운다.
 */
export function updateCombat(world, dt) {
  for (const unit of world.units.values()) {
    if (unit.cooldown > 0) unit.cooldown = Math.max(0, unit.cooldown - dt);
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

  if (order?.type === 'attack') {
    const target = world.entity(order.targetId);
    if (isEnemyAlive(target, unit.owner)) {
      unit.combatTargetId = target.id;
      return target;
    }
    world.stopUnit(unit); // 목표가 쓰러졌다
    return null;
  }

  let target = unit.combatTargetId != null ? world.entity(unit.combatTargetId) : null;
  if (!isEnemyAlive(target, unit.owner)) target = null;
  if (target && unit.autoTarget && gapBetween(unit, target) > acquireRange(def.attack) + LEASH_EXTRA) target = null;
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
  const range = acquireRange(def.attack);

  // 나를 때린 적이 쫓을 만한 거리에 있으면 먼저 반격한다
  const attacker = unit.lastAttackerId != null ? world.entity(unit.lastAttackerId) : null;
  if (
    isEnemyAlive(attacker, unit.owner) &&
    gapBetween(unit, attacker) <= range + LEASH_EXTRA &&
    computeDamage(def, targetInfo(attacker)) > 0
  ) {
    return attacker;
  }

  let best = null;
  let bestScore = Infinity;
  for (const other of world.units.values()) {
    if (other.owner === unit.owner || Math.abs(other.x - unit.x) > range + 1 || Math.abs(other.y - unit.y) > range + 1) continue;
    const gap = gapBetween(unit, other);
    if (gap > range || computeDamage(def, targetInfo(other)) <= 0) continue;
    const score = gap + (UNITS[other.type].worker ? WORKER_TARGET_PENALTY : 0);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  for (const building of world.buildings.values()) {
    if (building.owner === unit.owner) continue;
    const gap = gapBetween(unit, building);
    if (gap > range) continue;
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

  if (gapBetween(unit, target) <= attackReach(def.attack)) {
    unit.path = null;
    unit.pathPending = false;
    if (unit.cooldown <= 0) {
      strike(world, unit, def, target);
      unit.cooldown = def.attack.cooldown;
    }
    return;
  }

  if ((!unit.path && !unit.pathPending) || world.tick - unit.chaseTick >= CHASE_REPATH_TICKS) {
    unit.chaseTick = world.tick;
    chase(world, unit, def, target);
  }
}

function chase(world, unit, def, target) {
  if (!isUnit(target)) {
    world.moveUnit(unit, target, true);
    return;
  }
  const tile = { x: Math.floor(target.x), y: Math.floor(target.y), w: 1, h: 1 };
  // 곧장 보이면 적의 위치로 직선으로 다가간다 (칸 경로는 적 칸 옆 칸에서 멈춰 근접 공격이 안 닿을 수 있다)
  if (lineOfSight(world.nav, unit.x, unit.y, target.x, target.y, def.radius)) {
    unit.path = [[target.x, target.y]];
    unit.pathPending = false;
    unit.goal = { rect: tile, adjacent: true, point: null };
    unit.navVersion = world.nav.version;
    return;
  }
  world.moveUnit(unit, tile, true);
}

// ---------- 공격과 피해 ----------

function strike(world, attacker, def, target) {
  world.events.push([GAME_EVENT.ATTACK, attacker.id, target.id]);
  const splash = def.attack.splash;
  if (!splash) {
    hit(world, attacker, def, target);
    return;
  }
  const cx = isUnit(target) ? target.x : target.x + target.w / 2;
  const cy = isUnit(target) ? target.y : target.y + target.h / 2;
  for (const unit of world.units.values()) {
    if (unit.owner !== attacker.owner && Math.hypot(unit.x - cx, unit.y - cy) <= splash + UNITS[unit.type].radius) {
      hit(world, attacker, def, unit);
    }
  }
  for (const building of world.buildings.values()) {
    if (building.owner !== attacker.owner && distanceToRect(cx, cy, building) <= splash) hit(world, attacker, def, building);
  }
}

function hit(world, attacker, def, target) {
  if (target.hp <= 0) return;
  const damage = computeDamage(def, targetInfo(target));
  if (damage <= 0) return;
  target.hp -= damage;
  if (isUnit(target)) target.lastAttackerId = attacker.id;
}

// ---------- 감시탑 ----------

const towerGap = (building, unit) => distanceToRect(unit.x, unit.y, building) - UNITS[unit.type].radius;

function updateTower(world, building, dt) {
  const def = BUILDINGS[building.type];
  if (building.cooldown > 0) building.cooldown = Math.max(0, building.cooldown - dt);

  let target = building.combatTargetId != null ? world.units.get(building.combatTargetId) : null;
  if (!isEnemyAlive(target, building.owner) || towerGap(building, target) > def.attack.range) target = null;
  if (!target && (world.tick + building.id) % ACQUIRE_EVERY_TICKS === 0) {
    let bestScore = Infinity;
    for (const unit of world.units.values()) {
      if (unit.owner === building.owner) continue;
      const gap = towerGap(building, unit);
      if (gap > def.attack.range) continue;
      const score = gap + (UNITS[unit.type].worker ? WORKER_TARGET_PENALTY : 0);
      if (score < bestScore) {
        bestScore = score;
        target = unit;
      }
    }
  }
  building.combatTargetId = target?.id ?? null;
  if (target && building.cooldown <= 0) {
    strike(world, building, def, target);
    building.cooldown = def.attack.cooldown;
  }
}
