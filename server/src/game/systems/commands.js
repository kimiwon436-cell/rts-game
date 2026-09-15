import { UNITS } from '@rune/shared/data/units.js';
import { BUILDINGS, BUILD_MENU } from '@rune/shared/data/buildings.js';
import { AGES, MAX_AGE, RESOURCES } from '@rune/shared/data/economy.js';
import { MARKET, TRADABLE, buyCost, sellGain } from '@rune/shared/data/market.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { CMD, REJECT, UNIT_STATE } from '@rune/shared/protocol.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { missingResource } from '@rune/shared/rules/costs.js';
import { orderGather, orderReturnCargo } from './gathering.js';
import { cancelConstruction, orderConstruct } from './construction.js';

const MAX_UNIT_IDS = 60;
const NOT_ENOUGH = { gold: REJECT.NOT_ENOUGH_GOLD, wood: REJECT.NOT_ENOUGH_WOOD, mana: REJECT.NOT_ENOUGH_MANA };

/**
 * 네트워크로 받은 명령의 모양만 검사해 필요한 필드만 남긴다. 규칙 검사는 적용할 때 한다.
 * @returns {object | null} 모양이 틀리면 null
 */
export function sanitizeCommand(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.seq) || typeof raw.type !== 'string') return null;
  const cmd = { seq: raw.seq, type: raw.type, unitIds: [] };
  if (raw.unitIds !== undefined) {
    if (!Array.isArray(raw.unitIds)) return null;
    cmd.unitIds = [...new Set(raw.unitIds.filter(Number.isInteger))].slice(0, MAX_UNIT_IDS);
  }
  for (const key of ['x', 'y']) {
    if (raw[key] === undefined) continue;
    if (!Number.isFinite(raw[key])) return null;
    cmd[key] = raw[key];
  }
  for (const key of ['buildingId', 'tile']) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key])) return null;
    cmd[key] = raw[key];
  }
  for (const key of ['building', 'mineId', 'resource', 'action']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'string' || raw[key].length > 32) return null;
    cmd[key] = raw[key];
  }
  return cmd;
}

/** 이번 틱에 모인 명령을 받은 순서대로 적용한다. 거부한 명령은 rejects에 넣는다. */
export function applyCommands(world, commands, rejects) {
  for (const { slot, cmd } of commands) {
    const reason = world.players[slot] ? applyCommand(world, slot, cmd) : REJECT.INVALID;
    if (reason) rejects.push({ slot, seq: cmd.seq, reason });
  }
}

function applyCommand(world, slot, cmd) {
  switch (cmd.type) {
    case CMD.MOVE:
      return move(world, slot, cmd);
    case CMD.STOP:
      ownUnits(world, slot, cmd.unitIds).forEach((unit) => world.stopUnit(unit));
      return null;
    case CMD.GATHER:
      return gather(world, slot, cmd);
    case CMD.RETURN_CARGO:
      workers(world, slot, cmd.unitIds).forEach((unit) => orderReturnCargo(world, unit));
      return null;
    case CMD.PLACE:
      return place(world, slot, cmd);
    case CMD.CONSTRUCT:
      return construct(world, slot, cmd);
    case CMD.CANCEL_BUILD:
      return cancelBuild(world, slot, cmd);
    case CMD.AGE_UP:
      return ageUp(world, slot);
    case CMD.CANCEL_AGE_UP:
      return cancelAgeUp(world, slot);
    case CMD.TRADE:
      return trade(world, slot, cmd);
    default:
      return REJECT.INVALID;
  }
}

const ownUnits = (world, slot, ids) =>
  ids.map((id) => world.units.get(id)).filter((unit) => unit && unit.owner === slot);

const workers = (world, slot, ids) => ownUnits(world, slot, ids).filter((unit) => UNITS[unit.type].worker);

function pay(player, cost) {
  for (const resource of RESOURCES) player[resource] -= cost[resource] ?? 0;
}

function move(world, slot, { unitIds, x, y }) {
  const units = ownUnits(world, slot, unitIds);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!units.length || !world.nav.inside(tx, ty)) return REJECT.INVALID_TARGET;
  for (const unit of units) {
    world.stopUnit(unit);
    unit.order = { type: 'move' };
    unit.state = UNIT_STATE.MOVE;
    world.moveUnit(unit, { x: tx, y: ty, w: 1, h: 1 }, false, { x, y });
    if (!unit.path) world.stopUnit(unit);
  }
  return null;
}

function gather(world, slot, cmd) {
  const units = workers(world, slot, cmd.unitIds);
  if (!units.length) return REJECT.NO_WORKER;
  let target;
  if (cmd.mineId !== undefined) {
    if (!world.mines.has(cmd.mineId)) return REJECT.INVALID_TARGET;
    target = { mineId: cmd.mineId };
  } else if (cmd.tile !== undefined && world.tiles[cmd.tile] === TERRAIN.TREE) {
    target = { tile: cmd.tile };
  } else {
    return REJECT.INVALID_TARGET;
  }
  for (const unit of units) {
    world.stopUnit(unit);
    orderGather(world, unit, target);
  }
  return null;
}

function place(world, slot, cmd) {
  const def = BUILDINGS[cmd.building];
  if (!def || !BUILD_MENU.includes(cmd.building) || !Number.isInteger(cmd.x) || !Number.isInteger(cmd.y)) {
    return REJECT.INVALID;
  }
  const units = workers(world, slot, cmd.unitIds);
  if (!units.length) return REJECT.NO_WORKER;

  const player = world.players[slot];
  if (player.age < def.age) return REJECT.REQUIRES_AGE;
  const missing = missingResource(player, def.cost);
  if (missing) return NOT_ENOUGH[missing];

  const placement = checkPlacement({
    type: cmd.building,
    x: cmd.x,
    y: cmd.y,
    map: world.map,
    tiles: world.tiles,
    occupied: world.occupied,
    isWellTaken: (wellId) => world.isWellTaken(wellId),
  });
  if (placement !== PLACE.OK) return placement;

  pay(player, def.cost);
  const building = world.spawnBuilding(cmd.building, slot, cmd.x, cmd.y);
  for (const unit of units) {
    world.stopUnit(unit);
    orderConstruct(world, unit, building);
  }
  return null;
}

function construct(world, slot, cmd) {
  const building = world.buildings.get(cmd.buildingId);
  if (!building || building.owner !== slot || building.complete) return REJECT.INVALID_TARGET;
  const units = workers(world, slot, cmd.unitIds);
  if (!units.length) return REJECT.NO_WORKER;
  for (const unit of units) {
    world.stopUnit(unit);
    orderConstruct(world, unit, building);
  }
  return null;
}

function cancelBuild(world, slot, cmd) {
  const building = world.buildings.get(cmd.buildingId);
  if (!building || building.owner !== slot || building.complete) return REJECT.INVALID_TARGET;
  cancelConstruction(world, building);
  return null;
}

function ageUp(world, slot) {
  const player = world.players[slot];
  if (player.ageTarget) return REJECT.AGE_IN_PROGRESS;
  if (player.age >= MAX_AGE) return REJECT.MAX_AGE;
  const next = AGES[player.age + 1];
  if (!world.hasCompleted(slot, 'keep')) return REJECT.REQUIRES_BUILDING;
  if (next.requires?.some((type) => !world.hasCompleted(slot, type))) return REJECT.REQUIRES_BUILDING;
  const missing = missingResource(player, next.cost);
  if (missing) return NOT_ENOUGH[missing];

  pay(player, next.cost);
  player.ageTarget = player.age + 1;
  player.ageProgress = 0;
  return null;
}

function cancelAgeUp(world, slot) {
  const player = world.players[slot];
  if (!player.ageTarget) return REJECT.INVALID;
  const cost = AGES[player.ageTarget].cost;
  for (const resource of RESOURCES) player[resource] += cost[resource] ?? 0;
  player.ageTarget = 0;
  player.ageProgress = 0;
  return null;
}

function trade(world, slot, { resource, action }) {
  if (!TRADABLE.includes(resource) || (action !== 'buy' && action !== 'sell')) return REJECT.INVALID;
  if (!world.hasCompleted(slot, 'market')) return REJECT.NO_MARKET;

  const player = world.players[slot];
  const price = player.market[resource];
  if (action === 'buy') {
    const cost = buyCost(price);
    if (Math.floor(player.gold) < cost) return REJECT.NOT_ENOUGH_GOLD;
    player.gold -= cost;
    player[resource] += MARKET.lot;
    player.market[resource] = price * (1 + MARKET.priceStep);
  } else {
    if (Math.floor(player[resource]) < MARKET.lot) return NOT_ENOUGH[resource];
    player[resource] -= MARKET.lot;
    player.gold += sellGain(price);
    player.market[resource] = Math.max(MARKET.minPrice, price * (1 - MARKET.priceStep));
  }
  return null;
}
