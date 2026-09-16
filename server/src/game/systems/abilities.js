import { TICK_MS } from '@rune/shared/constants.js';
import { UNITS } from '@rune/shared/data/units.js';
import { ABILITIES, ABILITY_IDS, GARRISON } from '@rune/shared/data/abilities.js';
import { RESOURCES } from '@rune/shared/data/economy.js';
import { GAME_EVENT, REJECT, UNIT_STATE } from '@rune/shared/protocol.js';
import { POS_SCALE } from '@rune/shared/snapshot.js';
import { computeDamage } from '@rune/shared/rules/combat.js';

export const toTicks = (seconds) => Math.max(1, Math.round((seconds * 1000) / TICK_MS));

/** 능력 사용 효과 이벤트: 0 = 시작(영창), 1 = 발동, 2 = 취소 */
export const PHASE = Object.freeze({ START: 0, DONE: 1, CANCEL: 2 });

const abilityIndex = (id) => ABILITY_IDS.indexOf(id);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pushEffect(world, unit, abilityId, x, y, phase) {
  world.events.push([
    GAME_EVENT.ABILITY,
    unit.id,
    abilityIndex(abilityId),
    Math.round(x * POS_SCALE),
    Math.round(y * POS_SCALE),
    phase,
  ]);
}

/** 능력 하나를 때린 것으로 친다. 공격자 대신 임시 def를 쓴다 (능력 피해는 공격력과 따로 논다) */
function abilityHit(world, attacker, target, damage, type) {
  const fake = { attack: { damage, type, range: 99, cooldown: 1 } };
  const info = { def: UNITS[target.type], shieldWall: target.shieldWall };
  const dealt = computeDamage(fake, info) * damageTakenMultiplier(target);
  if (dealt <= 0) return;
  target.hp -= dealt;
  target.lastAttackerId = attacker.id;
}

/** 받는 피해 배율: 새벽의 오라(-15%)와 뿌리내리기(-30%) */
export function damageTakenMultiplier(target) {
  let multiplier = 1;
  if (target.aura) multiplier *= target.aura.resist;
  if (target.rooted) multiplier *= ABILITIES.root.damageTaken;
  return multiplier;
}

/** 주는 피해 배율: 새벽의 오라(+20%) */
export const damageDealtMultiplier = (attacker) => attacker.aura?.damage ?? 1;

export const isStunned = (world, unit) => unit.stunUntil > world.tick;
export const isSlowed = (world, unit) => unit.slowUntil > world.tick;

/** 둔화에 걸린 유닛은 이동·공격이 40% 느려진다 */
export const slowFactor = (world, unit) => (isSlowed(world, unit) ? 1 - ABILITIES.timeWard.slow : 1);

/** 지금 움직일 수 있는가 (기절·영창·뿌리내림·전환 중에는 못 움직인다) */
export function canMove(world, unit) {
  return !isStunned(world, unit) && !unit.channel && !unit.rooted && !unit.rootingUntil;
}

/** 지금 공격할 수 있는가 */
export function canAct(world, unit) {
  return !isStunned(world, unit) && !unit.channel && !unit.rootingUntil;
}

/**
 * 능력과 상태 효과를 한 틱 진행한다. 이동·전투보다 먼저 돌려서
 * 오라·기절·둔화·뿌리내리기가 이번 틱 이동과 공격에 바로 반영되게 한다.
 */
export function updateAbilities(world) {
  applyAuras(world);
  updateRooting(world);
  updateChannels(world);
  updateBoarding(world);
  updateRevive(world);
  refreshFlags(world);
}

// ---------- 새벽의 오라 ----------

function applyAuras(world) {
  for (const unit of world.units.values()) unit.aura = null;

  for (const source of world.units.values()) {
    const aura = UNITS[source.type].aura;
    if (!aura || source.hp <= 0 || source.carrierId) continue;
    for (const unit of world.units.values()) {
      if (world.areEnemies(unit.owner, source.owner) || unit.id === source.id) continue; // 아군(같은 팀)만, 자기 자신은 빼고
      if (distance(unit, source) <= aura.radius + UNITS[unit.type].radius) {
        unit.aura = { damage: aura.damage, resist: aura.resist };
      }
    }
  }
}

// ---------- 뿌리내리기 ----------

function updateRooting(world) {
  for (const unit of world.units.values()) {
    if (!unit.rootingUntil || world.tick < unit.rootingUntil) continue;
    unit.rootingUntil = 0;
    unit.rooted = unit.rootingTo;
    if (!unit.rooted) refundQueue(world, unit); // 뽑으면 생산 대기열은 취소하고 돌려준다
    pushEffect(world, unit, 'root', unit.x, unit.y, PHASE.DONE);
  }
}

export function refundQueue(world, entity) {
  const player = world.players[entity.owner];
  for (const item of entity.queue) {
    const cost = UNITS[item.type].cost;
    for (const resource of RESOURCES) player[resource] += cost[resource] ?? 0;
  }
  entity.queue = [];
}

// ---------- 성좌 붕괴 (영창) ----------

function updateChannels(world) {
  for (const unit of world.units.values()) {
    const channel = unit.channel;
    if (!channel) continue;

    if (isStunned(world, unit) || unit.path) {
      unit.channel = null;
      pushEffect(world, unit, channel.ability, channel.x, channel.y, PHASE.CANCEL);
      continue;
    }
    if (world.tick < channel.endTick) continue;

    unit.channel = null;
    const ability = ABILITIES[channel.ability];
    pushEffect(world, unit, channel.ability, channel.x, channel.y, PHASE.DONE);
    for (const target of world.units.values()) {
      if (!world.areEnemies(target.owner, unit.owner)) continue;
      if (Math.hypot(target.x - channel.x, target.y - channel.y) <= ability.radius + UNITS[target.type].radius) {
        abilityHit(world, unit, target, ability.damage, ability.damageType);
      }
    }
  }
}

// ---------- 등 위의 성채 ----------

function updateBoarding(world) {
  for (const carrier of world.units.values()) {
    if (carrier.garrison.length) world.moveGarrisonWithCarrier(carrier);
  }
  for (const unit of world.units.values()) {
    if (unit.order?.type !== 'board' || unit.carrierId) continue;
    const carrier = world.units.get(unit.order.targetId);
    if (!carrier || carrier.owner !== unit.owner || carrier.garrison.length >= GARRISON.capacity) {
      world.stopUnit(unit);
      continue;
    }
    if (distance(unit, carrier) <= GARRISON.boardRange + UNITS[carrier.type].radius) {
      world.boardUnit(carrier, unit);
      continue;
    }
    if (!unit.path && !unit.pathPending) {
      world.requestPath(unit, {
        rect: { x: Math.floor(carrier.x), y: Math.floor(carrier.y), w: 1, h: 1 },
        adjacent: true,
        point: null,
      });
      unit.state = UNIT_STATE.MOVE;
    }
  }
}

// ---------- 불멸의 맹세 (부활) ----------

function updateRevive(world) {
  for (const player of world.players) {
    if (!player?.revive || world.tick < player.revive.atTick) continue;
    if (player.defeated) {
      player.revive = null;
      continue;
    }
    const def = UNITS[player.revive.type];
    const keep = [...world.buildings.values()].find((b) => b.owner === player.slot && b.type === 'keep' && b.complete);
    if (!keep) continue; // 영주관을 다시 지을 때까지 기다린다
    const cost = def.revive.cost;
    if (RESOURCES.some((r) => Math.floor(player[r]) < (cost[r] ?? 0))) continue; // 값을 치를 수 있을 때까지 기다린다

    for (const resource of RESOURCES) player[resource] -= cost[resource] ?? 0;
    const unit = world.spawnUnitNear(player.revive.type, player.slot, keep, { x: world.width / 2, y: world.height / 2 });
    player.revive = null;
    world.events.push([GAME_EVENT.ULTIMATE_REVIVED, unit.id, player.slot]);
  }
}

/** 궁극 유닛이 쓰러졌다: 부활을 예약하거나(솔라리온), 태운 유닛을 내린다(아르카논) */
export function onUltimateDied(world, unit) {
  const def = UNITS[unit.type];
  world.events.push([GAME_EVENT.ULTIMATE_LOST, unit.owner, unit.type]);
  if (unit.garrison?.length) world.unloadAll(unit); // 등껍질이 무너져도 탄 유닛은 살아 나온다
  if (unit.queue?.length) refundQueue(world, unit);
  const player = world.players[unit.owner];
  if (def.revive && player && !player.defeated) {
    player.revive = { type: unit.type, atTick: world.tick + toTicks(def.revive.delay) };
  }
}

// ---------- 스냅샷용 파생 값 ----------

function refreshFlags(world) {
  for (const unit of world.units.values()) {
    unit.stunned = isStunned(world, unit);
    unit.slowed = isSlowed(world, unit);
    unit.rooting = unit.rootingUntil > 0;
    unit.channeling = Boolean(unit.channel);
    unit.buffed = Boolean(unit.aura);
    unit.carried = Boolean(unit.carrierId);
    unit.extra = unit.garrison.length || (unit.channel ? Math.max(0, unit.channel.endTick - world.tick) : 0);
  }
}

// ---------- 명령에서 부르는 진입점 ----------

/** 재사용 대기 틱. 에테리아는 마나 샘 1곳당 10%씩 줄어든다 (최대 40%) */
export function cooldownTicks(world, unit, ability) {
  const resonance = UNITS[unit.type].manaResonance;
  let seconds = ability.cooldown;
  if (resonance) {
    let obelisks = 0;
    for (const b of world.buildings.values()) {
      if (b.owner === unit.owner && b.type === 'obelisk' && b.complete) obelisks++;
    }
    seconds *= 1 - Math.min(resonance.max, obelisks * resonance.perObelisk);
  }
  return toTicks(seconds);
}

export const hasAbility = (unit, abilityId) => UNITS[unit.type].abilities?.includes(abilityId) ?? false;

/** 점과 선분 사이 거리 */
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * 땅을 찍어 쓰거나 바로 쓰는 능력. 켜고 끄는 능력은 toggleUnitAbility가 맡는다.
 * @returns {string | null} 거부 이유, 쓸 수 있으면 null
 */
export function useAbility(world, unit, abilityId, point) {
  const ability = ABILITIES[abilityId];
  if (!ability || ability.kind === 'toggle' || !hasAbility(unit, abilityId)) return REJECT.INVALID;
  if (!canAct(world, unit) || (unit.cooldowns[abilityId] ?? 0) > world.tick) return REJECT.ON_COOLDOWN;
  if (ability.kind === 'point') {
    if (!point || !world.nav.inside(Math.floor(point.x), Math.floor(point.y))) return REJECT.INVALID_TARGET;
    if (!ability.directional && ability.range && distance(unit, point) > ability.range) return REJECT.OUT_OF_RANGE;
  }

  switch (abilityId) {
    case 'dawnCharge':
      dawnCharge(world, unit, ability, point);
      break;
    case 'starfall':
      unit.channel = { ability: abilityId, endTick: world.tick + toTicks(ability.channel), x: point.x, y: point.y };
      unit.path = null;
      unit.pathPending = false;
      pushEffect(world, unit, abilityId, point.x, point.y, PHASE.START);
      break;
    case 'timeWard':
      timeWard(world, unit, ability, point);
      break;
    case 'unload':
      if (!unit.garrison.length) return REJECT.INVALID_TARGET;
      world.unloadAll(unit);
      pushEffect(world, unit, abilityId, unit.x, unit.y, PHASE.DONE);
      break;
    default:
      return REJECT.INVALID;
  }
  if (ability.cooldown) unit.cooldowns[abilityId] = world.tick + cooldownTicks(world, unit, ability);
  return null;
}

/** 여명 돌격: 막힐 때까지 직선으로 돌진하며 지나간 자리의 적을 때리고 기절시킨다 */
function dawnCharge(world, unit, ability, point) {
  const dx = point.x - unit.x;
  const dy = point.y - unit.y;
  const length = Math.hypot(dx, dy) || 1;
  const dirX = dx / length;
  const dirY = dy / length;
  const start = { x: unit.x, y: unit.y };

  let travelled = 0;
  const step = 0.2;
  while (travelled + step <= ability.range) {
    const nx = unit.x + dirX * (travelled + step);
    const ny = unit.y + dirY * (travelled + step);
    if (world.nav.isBlocked(Math.floor(nx), Math.floor(ny))) break;
    travelled += step;
  }
  const end = { x: start.x + dirX * travelled, y: start.y + dirY * travelled };

  for (const target of world.units.values()) {
    if (!world.areEnemies(target.owner, unit.owner)) continue;
    if (distanceToSegment(target, start, end) > ability.halfWidth + UNITS[target.type].radius) continue;
    abilityHit(world, unit, target, ability.damage, ability.damageType);
    target.stunUntil = Math.max(target.stunUntil, world.tick + toTicks(ability.stun));
    target.path = null;
  }

  unit.x = end.x;
  unit.y = end.y;
  unit.path = null;
  unit.pathPending = false;
  unit.navVersion = -1;
  pushEffect(world, unit, 'dawnCharge', end.x, end.y, PHASE.DONE);
}

/** 시간의 결계: 반경 안의 적을 6초간 느리게 만든다 */
function timeWard(world, unit, ability, point) {
  const until = world.tick + toTicks(ability.duration);
  for (const target of world.units.values()) {
    if (!world.areEnemies(target.owner, unit.owner)) continue;
    if (Math.hypot(target.x - point.x, target.y - point.y) > ability.radius + UNITS[target.type].radius) continue;
    target.slowUntil = Math.max(target.slowUntil, until);
  }
  pushEffect(world, unit, 'timeWard', point.x, point.y, PHASE.DONE);
}

/** 켜고 끄는 능력: 방패벽, 뿌리내리기 */
export function toggleUnitAbility(world, unit, abilityId, enable) {
  if (!hasAbility(unit, abilityId) && !(abilityId === 'shieldWall' && UNITS[unit.type].ability === 'shieldWall')) {
    return REJECT.INVALID;
  }
  if (abilityId === 'shieldWall') {
    unit.shieldWall = enable;
    return null;
  }
  if (abilityId !== 'root') return REJECT.INVALID;

  if (unit.rootingUntil) return REJECT.ON_COOLDOWN;
  if (unit.rooted === enable) return null;
  unit.path = null;
  unit.pathPending = false;
  if (enable) {
    unit.rooted = true; // 뿌리내리는 건 즉시
    pushEffect(world, unit, 'root', unit.x, unit.y, PHASE.DONE);
  } else {
    unit.rootingTo = false;
    unit.rootingUntil = world.tick + toTicks(ABILITIES.root.unrootTime); // 뽑는 데 5초
    pushEffect(world, unit, 'root', unit.x, unit.y, PHASE.START);
  }
  return null;
}

/** 등에 태우러 보낸다. 닿으면 updateBoarding이 태운다. */
export function orderBoard(world, units, carrier) {
  if (!UNITS[carrier.type].garrison) return REJECT.CANNOT_BOARD;
  const riders = units.filter((unit) => GARRISON.allow.includes(unit.type) && unit.id !== carrier.id);
  if (!riders.length) return REJECT.CANNOT_BOARD;
  if (carrier.garrison.length >= GARRISON.capacity) return REJECT.GARRISON_FULL;

  for (const unit of riders) {
    world.stopUnit(unit);
    unit.order = { type: 'board', targetId: carrier.id };
    unit.state = UNIT_STATE.MOVE;
  }
  return null;
}
