import { WORKER } from '@rune/shared/data/units.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { UNIT_STATE } from '@rune/shared/protocol.js';
import { ADJACENT_DISTANCE, distanceToRect } from '../World.js';

const TREE_SEARCH_RADIUS = 10;
const MAX_TREE_TRIES = 6;

// 채집 순환: toResource(자원으로 이동) → harvest(채집) → toDropoff(반납하러 이동) → toResource ...
// 반납할 건물이 없으면 waitDropoff에서 기다린다.

/** 명령이 가리키는 자원. 사라졌으면 null */
function resolveResource(world, order) {
  if (order.mineId) {
    const mine = world.mines.get(order.mineId);
    return mine ? { kind: 'gold', rect: mine, mine } : null;
  }
  if (order.tile == null || world.tiles[order.tile] !== TERRAIN.TREE) return null;
  return { kind: 'wood', rect: world.tileRect(order.tile), tile: order.tile };
}

/** 채집 명령. target은 { mineId } 또는 { tile }. 다른 종류의 자원을 들고 있으면 버린다. */
export function orderGather(world, unit, target) {
  const order = { type: 'gather', mineId: target.mineId ?? null, tile: target.tile ?? null };
  const resource = resolveResource(world, order);
  if (!resource) return false;
  if (unit.carry && unit.carry.kind !== resource.kind) unit.carry = null;
  unit.order = order;
  if (unit.carry && unit.carry.amount >= WORKER.carryCapacity) startReturn(world, unit, resource.kind);
  else goToResource(world, unit, resource);
  return true;
}

/** 들고 있는 자원만 반납하고 멈추는 명령 */
export function orderReturnCargo(world, unit) {
  if (!unit.carry) return false;
  unit.order = { type: 'returnCargo' };
  startReturn(world, unit, unit.carry.kind);
  return true;
}

export function updateGathering(world, dt) {
  for (const unit of world.units.values()) {
    if (unit.order?.type === 'gather') updateGatherer(world, unit, unit.order, dt);
    else if (unit.order?.type === 'returnCargo') updateReturner(world, unit);
  }
}

function updateGatherer(world, unit, order, dt) {
  switch (unit.phase) {
    case 'toResource': {
      if (unit.path) return;
      const resource = resolveResource(world, order);
      if (!resource) return onResourceGone(world, unit, order);
      if (distanceToRect(unit.x, unit.y, resource.rect) > ADJACENT_DISTANCE) {
        // 도착했지만 옆이 아니다 — 가는 동안 길이 막혔다
        if (resource.kind === 'wood') retargetTree(world, unit, resource.tile);
        else world.stopUnit(unit);
        return;
      }
      unit.phase = 'harvest';
      unit.harvest = 0;
      unit.state = UNIT_STATE.GATHER;
      return;
    }

    case 'harvest': {
      const resource = resolveResource(world, order);
      if (!resource) return onResourceGone(world, unit, order);
      unit.state = UNIT_STATE.GATHER;
      if (!unit.carry) unit.carry = { kind: resource.kind, amount: 0 };

      unit.harvest += WORKER.gatherRate[resource.kind] * dt;
      while (unit.harvest >= 1 && unit.carry.amount < WORKER.carryCapacity) {
        unit.harvest -= 1;
        unit.carry.amount += 1;
        if (resource.mine) {
          resource.mine.amount -= 1;
          if (resource.mine.amount <= 0) {
            world.depleteMine(resource.mine);
            break;
          }
        } else {
          world.treeWood[resource.tile] -= 1;
          if (world.treeWood[resource.tile] === 0) {
            world.fellTree(resource.tile);
            break;
          }
        }
      }
      if (unit.carry.amount >= WORKER.carryCapacity) startReturn(world, unit, resource.kind);
      return;
    }

    case 'toDropoff': {
      if (unit.path) return;
      if (!depositIfArrived(world, unit)) {
        if (unit.carry) startReturn(world, unit, unit.carry.kind);
        return;
      }
      const resource = resolveResource(world, order);
      if (resource) goToResource(world, unit, resource);
      else onResourceGone(world, unit, order);
      return;
    }

    case 'waitDropoff': {
      if (!unit.carry) return onResourceGone(world, unit, order);
      if (world.nearestDropoff(unit.owner, unit.carry.kind, unit.x, unit.y)) startReturn(world, unit, unit.carry.kind);
      return;
    }

    default:
      world.stopUnit(unit);
  }
}

function updateReturner(world, unit) {
  if (unit.phase === 'waitDropoff') {
    if (unit.carry && world.nearestDropoff(unit.owner, unit.carry.kind, unit.x, unit.y)) {
      startReturn(world, unit, unit.carry.kind);
    }
    return;
  }
  if (unit.path) return;
  depositIfArrived(world, unit);
  world.stopUnit(unit);
}

function goToResource(world, unit, resource) {
  unit.phase = 'toResource';
  unit.state = UNIT_STATE.MOVE;
  if (world.moveUnit(unit, resource.rect, true)) return;
  if (resource.kind === 'wood') retargetTree(world, unit, resource.tile);
  else world.stopUnit(unit);
}

function startReturn(world, unit, kind) {
  const dropoff = world.nearestDropoff(unit.owner, kind, unit.x, unit.y);
  if (!dropoff || !world.moveUnit(unit, dropoff, true)) {
    unit.phase = 'waitDropoff';
    unit.path = null;
    unit.state = UNIT_STATE.IDLE;
    return;
  }
  unit.phase = 'toDropoff';
  unit.state = UNIT_STATE.RETURN;
  unit.dropoffId = dropoff.id;
}

/** 반납 건물 옆에 도착했으면 자원을 넣는다 */
function depositIfArrived(world, unit) {
  const dropoff = world.buildings.get(unit.dropoffId);
  if (!unit.carry || !dropoff?.complete || distanceToRect(unit.x, unit.y, dropoff) > ADJACENT_DISTANCE) return false;
  world.players[unit.owner][unit.carry.kind] += unit.carry.amount;
  unit.carry = null;
  return true;
}

/** 자원이 사라졌을 때: 나무면 근처 나무로 옮기고, 아니면 들고 있는 것을 반납한 뒤 멈춘다 */
function onResourceGone(world, unit, order) {
  const full = unit.carry && unit.carry.amount >= WORKER.carryCapacity;
  if (order.tile != null && !full && retargetTree(world, unit, order.tile)) return;
  if (unit.carry?.amount > 0) {
    startReturn(world, unit, unit.carry.kind);
    return;
  }
  world.stopUnit(unit);
}

/** 근처에서 걸어서 닿는 나무를 찾아 옮긴다 */
function retargetTree(world, unit, aroundTile) {
  const cx = aroundTile != null ? (aroundTile % world.width) + 0.5 : unit.x;
  const cy = aroundTile != null ? Math.floor(aroundTile / world.width) + 0.5 : unit.y;
  let tries = 0;
  for (const tile of world.treesNear(cx, cy, TREE_SEARCH_RADIUS)) {
    if (tile === aroundTile) continue;
    if (++tries > MAX_TREE_TRIES) break;
    if (world.moveUnit(unit, world.tileRect(tile), true)) {
      unit.order = { type: 'gather', mineId: null, tile };
      unit.phase = 'toResource';
      unit.state = UNIT_STATE.MOVE;
      return true;
    }
  }
  if (unit.carry?.amount > 0) {
    unit.order = { type: 'returnCargo' };
    startReturn(world, unit, unit.carry.kind);
  } else {
    world.stopUnit(unit);
  }
  return false;
}
