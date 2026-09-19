import { UNITS, domainOf } from '@rune/shared/data/units.js';
import { BUILDINGS, BUILD_MENU, PRODUCTION_QUEUE_MAX } from '@rune/shared/data/buildings.js';
import { ABILITIES } from '@rune/shared/data/abilities.js';
import { OATHS, OATH_IDS } from '@rune/shared/data/oaths.js';
import { AGES, MAX_AGE, RESOURCES, TRIBUTE, tributeReceived } from '@rune/shared/data/economy.js';
import { MARKET, TRADABLE, buyCost, sellGain } from '@rune/shared/data/market.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { CMD, GAME_EVENT, REJECT, UNIT_STATE, VICTORY_REASON } from '@rune/shared/protocol.js';
import { computeDamage } from '@rune/shared/rules/combat.js';
import { PLACE, checkPlacement } from '@rune/shared/rules/placement.js';
import { canSell, missingResource, sellRefund } from '@rune/shared/rules/costs.js';
import { orderGather, orderReturnCargo } from './gathering.js';
import { cancelConstruction, orderConstruct } from './construction.js';
import { defeatPlayer } from './victory.js';
import { hasAbility, orderBoard, toggleUnitAbility, useAbility } from './abilities.js';

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
  for (const key of ['buildingId', 'tile', 'index', 'targetId', 'to', 'amount']) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key])) return null;
    cmd[key] = raw[key];
  }
  for (const key of ['building', 'unit', 'mineId', 'resource', 'action', 'ability', 'oath']) {
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
    case CMD.SELL_BUILDING:
      return sellBuilding(world, slot, cmd);
    case CMD.AGE_UP:
      return ageUp(world, slot);
    case CMD.CANCEL_AGE_UP:
      return cancelAgeUp(world, slot);
    case CMD.TRADE:
      return trade(world, slot, cmd);
    case CMD.TRAIN:
      return train(world, slot, cmd);
    case CMD.CANCEL_TRAIN:
      return cancelTrain(world, slot, cmd);
    case CMD.SET_RALLY:
      return setRally(world, slot, cmd);
    case CMD.ATTACK:
      return attack(world, slot, cmd);
    case CMD.ATTACK_MOVE:
      return move(world, slot, cmd, true);
    case CMD.TOGGLE_ABILITY:
      return toggleAbility(world, slot, cmd);
    case CMD.USE_ABILITY:
      return castAbility(world, slot, cmd);
    case CMD.BOARD:
      return board(world, slot, cmd);
    case CMD.TAKE_OATH:
      return takeOath(world, slot, cmd);
    case CMD.SEND_RESOURCES:
      return sendResources(world, slot, cmd);
    case CMD.SURRENDER:
      defeatPlayer(world, world.players[slot], VICTORY_REASON.SURRENDER);
      return null;
    default:
      return REJECT.INVALID;
  }
}

// 아르카논 등에 탄 유닛은 명령을 받지 않는다 (내리기는 태운 쪽에 명령한다)
const ownUnits = (world, slot, ids) =>
  ids.map((id) => world.units.get(id)).filter((unit) => unit && unit.owner === slot && !unit.carrierId);

const workers = (world, slot, ids) => ownUnits(world, slot, ids).filter((unit) => UNITS[unit.type].worker);

function pay(player, cost) {
  for (const resource of RESOURCES) player[resource] -= cost[resource] ?? 0;
}

/** 배가 뭍을 찍었을 때 가장 가까운 물을 찾는 거리 (맵 한쪽 끝까지) */
const NAVAL_TARGET_SEARCH = 48;

/**
 * 이동과 공격 이동. 공격 이동은 가는 길에 만난 적과 싸우고(combat.js) 다시 목적지로 간다.
 * 다니는 곳(뭍·물·하늘)마다 따로 자리를 잡는다: 배는 찍은 곳에서 가장 가까운 물로, 뭍 유닛은 가장 가까운 뭍으로,
 * 공중 유닛은 찍은 곳 그대로.
 */
function move(world, slot, { unitIds, x, y }, attacking = false) {
  const units = ownUnits(world, slot, unitIds);
  if (!units.length || !world.nav.inside(Math.floor(x), Math.floor(y))) return REJECT.INVALID_TARGET;

  let moved = false;
  for (const domain of ['land', 'water', 'air']) {
    const group = units.filter((u) => domainOf(u.type) === domain);
    if (!group.length) continue;
    // 목적지는 서 있을 자리에서 고른다: 우리 건물 안으로 지나갈 수는 있어도 그 안에 멈춰 서지는 않는다
    const nav = world.navForType(group[0].type);
    const slots = world.destinationSlots(x, y, group.length, nav, nav === world.waterNav ? NAVAL_TARGET_SEARCH : 12);
    if (!slots.length) continue;

    // 한 기만 보낼 때는 누른 지점 그대로, 무리는 서로 다른 칸의 중심으로
    const exact = group.length === 1 && !nav.isBlocked(Math.floor(x), Math.floor(y));
    for (const [unit, [sx, sy]] of assignSlots(group, slots, x, y)) {
      const goal = {
        rect: { x: sx, y: sy, w: 1, h: 1 },
        adjacent: false,
        point: exact ? { x, y } : { x: sx + 0.5, y: sy + 0.5 },
      };
      world.stopUnit(unit);
      unit.order = attacking ? { type: 'attackMove', goal } : { type: 'move' };
      unit.state = UNIT_STATE.MOVE;
      world.requestPath(unit, goal);
    }
    moved = true;
  }
  return moved ? null : REJECT.INVALID_TARGET;
}

function attack(world, slot, { unitIds, targetId }) {
  const target = world.entity(targetId);
  if (!target || !world.areEnemies(target.owner, slot) || target.hp <= 0) return REJECT.INVALID_TARGET;
  if (!world.canTarget(world.teamOf(slot), target)) return REJECT.INVALID_TARGET; // 안개 속의 적 (본 적 있는 건물은 된다)
  const info = UNITS[target.type] ? { def: UNITS[target.type], shieldWall: target.shieldWall } : { building: true, type: target.type };
  const units = ownUnits(world, slot, unitIds).filter((unit) => computeDamage(UNITS[unit.type], info) > 0);
  if (!units.length) return REJECT.CANNOT_ATTACK;
  for (const unit of units) {
    world.stopUnit(unit);
    unit.order = { type: 'attack', targetId: target.id };
    unit.state = UNIT_STATE.ATTACK;
  }
  return null;
}

/**
 * 켜고 끄는 능력 (방패벽, 뿌리내리기).
 * 고른 유닛 중 하나라도 꺼져 있으면 모두 켜고, 모두 켜져 있으면 모두 끈다.
 */
function toggleAbility(world, slot, { unitIds, ability }) {
  if (ABILITIES[ability]?.kind !== 'toggle') return REJECT.INVALID;
  const isOn = (unit) => (ability === 'shieldWall' ? unit.shieldWall : unit.rooted);
  const units = ownUnits(world, slot, unitIds).filter(
    (unit) => hasAbility(unit, ability) || (ability === 'shieldWall' && UNITS[unit.type].ability === 'shieldWall'),
  );
  if (!units.length) return REJECT.INVALID_TARGET;

  const enable = units.some((unit) => !isOn(unit));
  let reason = null;
  for (const unit of units) reason = toggleUnitAbility(world, unit, ability, enable) ?? reason;
  return reason;
}

/** 땅을 찍어 쓰거나 바로 쓰는 능력 (여명 돌격·성좌 붕괴·시간의 결계·내리기) */
function castAbility(world, slot, { unitIds, ability, x, y }) {
  const point = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  const units = ownUnits(world, slot, unitIds).filter((unit) => hasAbility(unit, ability));
  if (!units.length) return REJECT.INVALID_TARGET;

  let reason = null;
  let used = false;
  for (const unit of units) {
    const result = useAbility(world, unit, ability, point);
    if (result) reason = result;
    else used = true;
  }
  return used ? null : reason;
}

/** 아르카논 등이나 수송선에 태우기 */
function board(world, slot, { unitIds, targetId }) {
  const carrier = world.units.get(targetId);
  if (!carrier || carrier.owner !== slot || carrier.carrierId) return REJECT.INVALID_TARGET;
  const units = ownUnits(world, slot, unitIds);
  if (!units.length) return REJECT.INVALID_TARGET;
  return orderBoard(world, units, carrier);
}

/** 맹세를 맺는다. 한 경기에 한 번, 번복할 수 없다. */
function takeOath(world, slot, { oath }) {
  const player = world.players[slot];
  if (!OATHS[oath]) return REJECT.INVALID;
  if (player.oath) return REJECT.OATH_ALREADY_TAKEN;
  if (!world.hasCompleted(slot, 'sanctum')) return REJECT.REQUIRES_BUILDING;

  player.oath = oath;
  world.events.push([GAME_EVENT.OATH_TAKEN, slot, OATH_IDS.indexOf(oath)]);
  return null;
}

/**
 * 팀원에게 자원을 보낸다. 운송 수수료를 떼고 도착한다 (docs/GAME_DESIGN.md 6장 팀전).
 * 보내는 사람도 받는 사람도 아직 쓰러지지 않은 같은 팀이어야 한다.
 */
function sendResources(world, slot, { to, resource, amount }) {
  if (!RESOURCES.includes(resource) || !Number.isInteger(amount) || amount <= 0 || amount > TRIBUTE.max) {
    return REJECT.INVALID;
  }
  const sender = world.players[slot];
  const receiver = world.players[to];
  if (!receiver || to === slot || world.areEnemies(slot, to) || receiver.defeated || sender.defeated) {
    return REJECT.INVALID_TARGET;
  }
  if (Math.floor(sender[resource]) < amount) return NOT_ENOUGH[resource];

  const received = tributeReceived(amount);
  sender[resource] -= amount;
  receiver[resource] += received;
  world.events.push([GAME_EVENT.RESOURCES_SENT, slot, to, RESOURCES.indexOf(resource), amount, received]);
  return null;
}

/**
 * 무리 이동: 유닛마다 서로 다른 목적지 칸을 준다.
 * 모여 있는 무리는 지금 대형을 유지하고, 흩어진 무리는 목표 주변으로 모인다.
 * @returns {Array<[unit, [tx, ty]]>}
 */
export function assignSlots(units, slots, x, y) {
  const cx = units.reduce((sum, u) => sum + u.x, 0) / units.length;
  const cy = units.reduce((sum, u) => sum + u.y, 0) / units.length;
  const spread = Math.max(0, ...units.map((u) => Math.hypot(u.x - cx, u.y - cy)));
  const maxRadius = Math.sqrt(units.length) * 0.75;
  const scale = spread > maxRadius ? maxRadius / spread : 1;

  // 목표에서 먼 자리를 원하는 유닛부터 고르게 해 가운데 칸이 먼저 동나지 않게 한다
  const wishes = units
    .map((unit) => ({ unit, wx: x + (unit.x - cx) * scale, wy: y + (unit.y - cy) * scale }))
    .sort((a, b) => Math.hypot(b.wx - x, b.wy - y) - Math.hypot(a.wx - x, a.wy - y));

  const free = slots.slice();
  const assigned = [];
  for (const { unit, wx, wy } of wishes) {
    if (free.length === 0) free.push(...slots); // 빈 칸이 모자라면 다시 쓴다
    let best = 0;
    let bestDistance = Infinity;
    free.forEach(([sx, sy], i) => {
      const d = Math.hypot(sx + 0.5 - wx, sy + 0.5 - wy);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    assigned.push([unit, free[best]]);
    free.splice(best, 1);
  }
  return assigned;
}

/** 생산처: 완성된 내 건물, 또는 뿌리내린 내 아르카논 */
function producer(world, slot, id) {
  const building = world.buildings.get(id);
  if (building) {
    if (building.owner !== slot || !building.complete) return null;
    return { entity: building, trains: BUILDINGS[building.type].trains };
  }
  const unit = world.units.get(id);
  if (unit && unit.owner === slot && unit.rooted) return { entity: unit, trains: ABILITIES.root.trains };
  return null;
}

/** 살아 있거나, 생산 중이거나, 부활을 기다리는 궁극 유닛이 있는가 (한 경기에 한 기) */
function hasUltimate(world, player) {
  if (player.revive) return true;
  for (const unit of world.units.values()) {
    if (unit.owner === player.slot && UNITS[unit.type].ultimate) return true;
  }
  for (const building of world.buildings.values()) {
    if (building.owner === player.slot && building.queue.some((item) => UNITS[item.type].ultimate)) return true;
  }
  return false;
}

function train(world, slot, { buildingId, unit: type }) {
  const source = producer(world, slot, buildingId);
  if (!source) return REJECT.INVALID_TARGET;
  const def = UNITS[type];
  if (!def || !source.trains?.includes(type)) return REJECT.INVALID;

  const player = world.players[slot];
  if (player.age < def.age) return REJECT.REQUIRES_AGE;
  if (def.oath && player.oath !== def.oath) return REJECT.REQUIRES_OATH; // 맺은 맹세의 유닛만
  if (def.ultimate && hasUltimate(world, player)) return REJECT.ULTIMATE_EXISTS;
  if (source.entity.queue.length >= PRODUCTION_QUEUE_MAX) return REJECT.QUEUE_FULL;
  const missing = missingResource(player, def.cost);
  if (missing) return NOT_ENOUGH[missing];

  pay(player, def.cost);
  source.entity.queue.push({ type, progress: 0, blocked: false });
  return null;
}

/** 생산 취소: 비용을 모두 돌려준다 */
function cancelTrain(world, slot, { buildingId, index }) {
  const entity = world.buildings.get(buildingId) ?? world.units.get(buildingId);
  if (!entity || entity.owner !== slot || !Number.isInteger(index) || !entity.queue?.[index]) {
    return REJECT.INVALID_TARGET;
  }
  const [item] = entity.queue.splice(index, 1);
  const cost = UNITS[item.type].cost;
  for (const resource of RESOURCES) world.players[slot][resource] += cost[resource] ?? 0;
  return null;
}

function setRally(world, slot, cmd) {
  const building = world.buildings.get(cmd.buildingId);
  if (!building || building.owner !== slot || !BUILDINGS[building.type].trains) return REJECT.INVALID_TARGET;
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y) || !world.nav.inside(Math.floor(cmd.x), Math.floor(cmd.y))) {
    return REJECT.INVALID_TARGET;
  }
  building.rally = {
    x: cmd.x,
    y: cmd.y,
    mineId: cmd.mineId !== undefined && world.mines.has(cmd.mineId) ? cmd.mineId : null,
    tile: cmd.tile !== undefined && world.tiles[cmd.tile] === TERRAIN.TREE ? cmd.tile : null,
  };
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

/**
 * 건물 판매: 완성된 내 건물을 허물고 비용의 절반 × 남은 체력만큼 돌려받는다.
 * 생산 대기열은 취소한 것처럼 전액 돌려준다. 영주관은 팔 수 없다 (무너지면 지는 건물이다)
 */
function sellBuilding(world, slot, { buildingId }) {
  const building = world.buildings.get(buildingId);
  if (!building || building.owner !== slot || !building.complete || building.hp <= 0) return REJECT.INVALID_TARGET;
  if (!canSell(building.type)) return REJECT.CANNOT_SELL;

  const player = world.players[slot];
  const refund = sellRefund(building.type, building.hp / building.maxHp);
  for (const item of building.queue) {
    for (const resource of RESOURCES) refund[resource] += UNITS[item.type].cost[resource] ?? 0;
  }
  building.queue = [];
  for (const resource of RESOURCES) player[resource] += refund[resource];
  world.removeBuilding(building);
  world.events.push([GAME_EVENT.BUILDING_SOLD, building.id, slot, ...RESOURCES.map((resource) => refund[resource])]);
  return null;
}

function ageUp(world, slot) {
  const player = world.players[slot];
  if (player.ageTarget) return REJECT.AGE_IN_PROGRESS;
  if (player.age >= MAX_AGE) return REJECT.MAX_AGE;
  const next = AGES[player.age + 1];
  if (!world.hasCompleted(slot, 'keep')) return REJECT.REQUIRES_BUILDING;
  if (next.requires?.some((type) => !world.hasCompleted(slot, type))) return REJECT.REQUIRES_BUILDING;
  if (next.requiresAny) {
    const built = next.requiresAny.types.filter((type) => world.hasCompleted(slot, type)).length;
    if (built < next.requiresAny.count) return REJECT.REQUIRES_BUILDING;
  }
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
