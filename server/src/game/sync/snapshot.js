import {
  buildingMatchesEncoding,
  diffBuilding,
  diffUnit,
  encodeAllies,
  encodeBuilding,
  encodeOwn,
  encodePlayer,
  encodePublicPlayer,
  encodeUnit,
  POS_SCALE,
  unitMatchesEncoding,
} from '@rune/shared/snapshot.js';
import { BUILDINGS, BUILDING_TYPES } from '@rune/shared/data/buildings.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';

const publicPlayers = (world) => world.players.filter(Boolean).map((p) => encodePublicPlayer(p, world.tick));

/** 팀원 자원은 자주 바뀌니 이 틱 간격으로만 살핀다 (0.5초) */
const ALLIES_INTERVAL = 10;

/** 건물 인코딩에서 풋프린트 사각형 (안개 속에 남은 건물이 다시 보이는지 볼 때) */
function rectOfEncoded(encoded) {
  const size = BUILDINGS[BUILDING_TYPES[encoded[1]]].size;
  return { x: encoded[3], y: encoded[4], w: size, h: size };
}

/**
 * 틱마다 바뀐 것만 보내기 위해 지난번에 보낸 인코딩을 들고 있다가 비교한다.
 * (엔티티마다 dirty 비트를 다는 대신 인코딩을 비교한다 — 시스템 코드가 단순해지고 결과는 같다)
 *
 * 전장의 안개 때문에 팀마다 보는 세상이 다르므로 기준선도 팀마다(TeamView) 따로 둔다.
 * 같은 팀 플레이어는 같은 팀 델타를 받고, 그 위에 자기 자원·생산 정보만 얹는다.
 *
 * 스냅샷 모양: { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own?, allies? }
 * - addU/addB: 새로 보이게 된 유닛·건물 (전체 인코딩)
 * - updU/updB: [id, 마스크, ...바뀐 값]
 * - del: 사라진 유닛·건물 id — 쓰러졌거나, 적 유닛이 안개 속으로 들어갔거나, 안개 속에서 무너진 건물을 다시 보았다
 * - mines: 양이 바뀐 금광 [id, 남은 양] (0이면 다 캤다는 뜻). 안개 속 금광은 마지막으로 본 양 그대로다
 * - me/own/players: 내 자원, 내 건물의 생산 대기열·집결지, 모두의 시대·패배 여부
 * - allies: 팀원의 자원 [[slot, 금, 목재, 마나]] (팀전, 0.5초마다 바뀌었을 때만)
 * - ev: 그 팀이 볼 수 있는 이벤트만 (TeamView.eventVisible)
 *
 * 비어 있는 항목은 키째로 빼고 보낸다. 아무도 움직이지 않는 틱은 { t }만 나간다.
 * 쓰는 법: 틱마다 update(world, events) 한 번 → 플레이어마다 snapshotFor(world, slot) 또는 full(world, slot)
 */
export class SnapshotFeed {
  constructor(world) {
    this.teams = world.vision.counts.map((_, team) => new TeamView(team, world));
    this.players = ''; // 마지막으로 보낸 공개 플레이어 정보의 JSON
    this.own = new Map(); // slot → 마지막으로 보낸 own의 JSON
    this.me = new Map(); // slot → 마지막으로 보낸 me의 JSON
    this.allies = new Map(); // slot → 마지막으로 보낸 allies의 JSON
    // 유닛·건물마다 가장 최근 인코딩. 바뀌지 않았으면 같은 배열을 그대로 두어
    // 팀 기준선과 같은 객체인지(===)만 보고 비교를 건너뛴다. 두 팀이 같은 유닛을 봐도 한 번만 만든다
    this.unitCodes = new Map();
    this.buildingCodes = new Map();
  }

  /** 틱마다 한 번: 팀마다 이번 틱에 보낼 델타를 만든다. 부르면 기준선이 이번 틱 상태로 갱신된다. */
  update(world, events) {
    const players = publicPlayers(world);
    const json = JSON.stringify(players);
    const playersChanged = this.players !== json;
    if (playersChanged) this.players = json;

    refreshCodes(this.unitCodes, world.units, unitMatchesEncoding, encodeUnit);
    refreshCodes(this.buildingCodes, world.buildings, buildingMatchesEncoding, encodeBuilding);

    for (const view of this.teams) view.update(world, events, this, playersChanged ? players : null);
  }

  /** 그 플레이어가 이번 틱에 받을 스냅샷: 팀 델타 + 내 자원·생산 정보·팀원 자원 (바뀌었을 때만) */
  snapshotFor(world, slot) {
    const snapshot = { ...this.teams[world.teamOf(slot)].delta };

    const me = encodePlayer(world.players[slot]);
    const meJson = JSON.stringify(me);
    if (this.me.get(slot) !== meJson) {
      this.me.set(slot, meJson);
      snapshot.me = me;
    }

    const own = encodeOwn(world.buildings.values(), world.units.values(), slot);
    const ownJson = JSON.stringify(own);
    if (this.own.get(slot) !== ownJson) {
      this.own.set(slot, ownJson);
      snapshot.own = own;
    }

    if (world.tick % ALLIES_INTERVAL === 0) {
      const allies = encodeAllies(world.players, slot);
      const alliesJson = JSON.stringify(allies);
      if (allies.length && this.allies.get(slot) !== alliesJson) {
        this.allies.set(slot, alliesJson);
        snapshot.allies = allies;
      }
    }
    return snapshot;
  }

  /** 처음 들어왔거나 끊겼다 돌아온 플레이어에게 보내는 전체 상태 (그 팀이 아는 세상). 이번 틱 update 뒤에 부른다. */
  full(world, slot) {
    const view = this.teams[world.teamOf(slot)];
    // 이미 베인 나무 중 이 팀이 본 것. 델타에서는 TREE_FELLED 이벤트로 알리지만, 전체 상태에는 따로 실어야 한다
    const felled = [];
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.map.tiles[i] === TERRAIN.TREE && world.tiles[i] !== TERRAIN.TREE && !view.pendingFelled.has(i)) felled.push(i);
    }
    const own = encodeOwn(world.buildings.values(), world.units.values(), slot);
    const me = encodePlayer(world.players[slot]);
    const players = publicPlayers(world);
    const allies = encodeAllies(world.players, slot);
    this.own.set(slot, JSON.stringify(own));
    this.me.set(slot, JSON.stringify(me));
    this.allies.set(slot, JSON.stringify(allies));
    const snapshot = {
      t: world.tick,
      full: true,
      players,
      addU: [...view.units.values()],
      addB: [...view.buildings.values()],
      mines: [...view.mines],
      felled,
      me,
      own,
    };
    if (allies.length) snapshot.allies = allies;
    return snapshot;
  }
}

/** 바뀐 것만 새로 인코딩하고, 사라진 것의 인코딩은 버린다 */
function refreshCodes(codes, entities, matches, encode) {
  for (const entity of entities.values()) {
    const code = codes.get(entity.id);
    if (!code || !matches(entity, code)) codes.set(entity.id, encode(entity));
  }
  if (codes.size === entities.size) return; // 모두 살아 있다
  for (const id of codes.keys()) if (!entities.has(id)) codes.delete(id);
}

/** 한 팀이 보는 세상: 그 팀에게 마지막으로 보낸 것들과 이번 틱 델타 */
class TeamView {
  constructor(team, world) {
    this.team = team;
    this.units = new Map(); // id → 보낸 인코딩. 지금 보이는 유닛만 들어 있다
    this.buildings = new Map(); // id → 마지막으로 본 인코딩. 안개 속 적 건물은 본 모습 그대로 남는다
    this.mines = new Map(world.map.goldMines.map((m) => [m.id, m.amount])); // 금광 → 마지막으로 본 남은 양
    this.mineRects = new Map(world.map.goldMines.map((m) => [m.id, m]));
    this.pendingFelled = new Set(); // 안개 속에서 베여 이 팀이 아직 모르는 나무 칸
    this.gone = new Set(); // 이번 틱에 del로 지운 id (그 유닛의 죽음·공격 이벤트를 보여 주려고)
    this.delta = { t: world.tick };
  }

  sees(world, unit) {
    return world.teamOf(unit.owner) === this.team || world.vision.isVisible(this.team, unit.x, unit.y);
  }

  update(world, events, feed, players) {
    const { team, gone } = this;
    const { vision } = world;
    const addU = [];
    const updU = [];
    const addB = [];
    const updB = [];
    const del = [];
    const mines = [];
    const ev = [];
    gone.clear();

    // 유닛: 우리 팀 것과 지금 보이는 적
    for (const unit of world.units.values()) {
      if (!this.sees(world, unit)) continue;
      const encoded = feed.unitCodes.get(unit.id);
      const previous = this.units.get(unit.id);
      if (previous === encoded) continue; // 지난번에 보낸 그대로다
      if (!previous) {
        addU.push(encoded);
      } else {
        const delta = diffUnit(previous, encoded);
        if (delta) updU.push(delta);
      }
      this.units.set(unit.id, encoded);
    }
    for (const id of this.units.keys()) {
      const unit = world.units.get(id);
      if (unit && this.sees(world, unit)) continue;
      this.units.delete(id); // 쓰러졌거나 안개 속으로 들어갔다
      del.push(id);
      gone.add(id);
    }

    // 건물: 우리 팀 것과 지금 보이는 적 건물. 안 보이는 적 건물은 마지막으로 본 모습으로 남긴다
    for (const building of world.buildings.values()) {
      if (world.teamOf(building.owner) !== team && !vision.isRectVisible(team, building)) continue;
      const encoded = feed.buildingCodes.get(building.id);
      const previous = this.buildings.get(building.id);
      if (previous === encoded) continue;
      if (!previous) {
        addB.push(encoded);
      } else {
        const delta = diffBuilding(previous, encoded);
        if (delta) updB.push(delta);
      }
      this.buildings.set(building.id, encoded);
    }
    for (const [id, encoded] of this.buildings) {
      if (world.buildings.has(id)) continue;
      // 무너진 건물: 우리 것이거나, 그 자리가 보이거나, 주인이 쓰러졌을 때(모두에게 알려진 일) 지운다.
      // 안개 속이면 무너진 줄 모른 채 남는다
      const known = world.teamOf(encoded[2]) === team || world.players[encoded[2]]?.defeated;
      if (!known && !vision.isRectVisible(team, rectOfEncoded(encoded))) continue;
      this.buildings.delete(id);
      del.push(id);
      gone.add(id);
    }

    // 금광: 보이는 금광만 남은 양을 새로 알린다
    for (const mine of world.mines.values()) {
      if (this.mines.get(mine.id) === mine.amount || !vision.isRectVisible(team, mine)) continue;
      this.mines.set(mine.id, mine.amount);
      mines.push([mine.id, mine.amount]);
    }
    for (const id of this.mines.keys()) {
      if (world.mines.has(id) || !vision.isRectVisible(team, this.mineRects.get(id))) continue;
      this.mines.delete(id);
      mines.push([id, 0]);
    }

    // 안개 속에서 베인 나무는 그 칸을 볼 때 알린다
    for (const tile of this.pendingFelled) {
      if (!vision.isTileVisible(team, tile)) continue;
      this.pendingFelled.delete(tile);
      ev.push([GAME_EVENT.TREE_FELLED, tile]);
    }
    for (const event of events) {
      if (event[0] === GAME_EVENT.TREE_FELLED && !vision.isTileVisible(team, event[1])) {
        this.pendingFelled.add(event[1]);
      } else if (this.eventVisible(world, event)) {
        ev.push(event);
      }
    }

    const delta = { t: world.tick };
    if (players) delta.players = players;
    if (addU.length) delta.addU = addU;
    if (updU.length) delta.updU = updU;
    if (addB.length) delta.addB = addB;
    if (updB.length) delta.updB = updB;
    if (del.length) delta.del = del;
    if (mines.length) delta.mines = mines;
    if (ev.length) delta.ev = ev;
    this.delta = delta;
  }

  /** 이 팀에게 보여 줄 이벤트인가. 상대 진영 안쪽의 일은 보일 때만 알린다 */
  eventVisible(world, event) {
    const { team } = this;
    switch (event[0]) {
      case GAME_EVENT.TREE_FELLED:
        return true; // 보이는 칸만 여기까지 온다
      case GAME_EVENT.MINE_DEPLETED:
        return world.vision.isRectVisible(team, this.mineRects.get(event[1]));
      case GAME_EVENT.BUILT:
      case GAME_EVENT.TRAINED:
        return world.teamOf(event[2]) === team || this.shows(world, event[1]);
      case GAME_EVENT.ATTACK:
        return this.shows(world, event[1]) || this.shows(world, event[2]);
      case GAME_EVENT.UNIT_DIED:
      case GAME_EVENT.BUILDING_DESTROYED:
        return this.gone.has(event[1]); // 이번 틱에 지운 것(보이던 것)만
      case GAME_EVENT.ABILITY:
        return this.shows(world, event[1]) || world.vision.isVisible(team, event[3] / POS_SCALE, event[4] / POS_SCALE);
      case GAME_EVENT.ULTIMATE_REVIVED:
        return world.teamOf(event[2]) === team || this.shows(world, event[1]);
      case GAME_EVENT.RESOURCES_SENT:
        return world.teamOf(event[1]) === team; // 누가 누구에게 무엇을 보냈는지는 상대가 몰라야 한다
      default:
        return true; // 시대 발전·맹세·왕관 몰락·패배·궁극 유닛 쓰러짐은 모두에게 알린다
    }
  }

  /** 이 팀이 지금 보고 있거나 이번 틱에 막 사라진 유닛·건물인가 */
  shows(world, id) {
    if (this.units.has(id) || this.gone.has(id)) return true;
    const building = world.buildings.get(id);
    return Boolean(building) && (world.teamOf(building.owner) === this.team || world.vision.isRectVisible(this.team, building));
  }
}
