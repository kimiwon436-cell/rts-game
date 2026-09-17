import {
  diffBuilding,
  diffUnit,
  encodeAllies,
  encodeBuilding,
  encodeOwn,
  encodePlayer,
  encodePublicPlayer,
  encodeUnit,
} from '@rune/shared/snapshot.js';
import { TERRAIN } from '@rune/shared/map/grid.js';
import { GAME_EVENT } from '@rune/shared/protocol.js';

const publicPlayers = (world) => world.players.filter(Boolean).map((p) => encodePublicPlayer(p, world.tick));

/** 팀원 자원은 자주 바뀌니 이 틱 간격으로만 살핀다 (0.5초) */
const ALLIES_INTERVAL = 10;

/** 이벤트를 받을 팀. null이면 모두가 받는다 */
function eventTeam(world, event) {
  switch (event[0]) {
    case GAME_EVENT.RESOURCES_SENT:
      return world.teamOf(event[1]); // 누가 누구에게 무엇을 보냈는지는 상대가 몰라야 한다
    default:
      return null;
  }
}

/**
 * 틱마다 바뀐 것만 보내기 위해 지난번에 보낸 인코딩을 들고 있다가 비교한다.
 * (엔티티마다 dirty 비트를 다는 대신 인코딩을 비교한다 — 시스템 코드가 단순해지고 결과는 같다)
 *
 * 스냅샷 모양: { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own?, allies? }
 * - addU/addB: 새로 생긴 유닛·건물 (전체 인코딩)
 * - updU/updB: [id, 마스크, ...바뀐 값]
 * - del: 사라진 유닛·건물 id
 * - mines: 양이 바뀐 금광 [id, 남은 양] (0이면 다 캤다는 뜻)
 * - me/own/players: 내 자원, 내 건물의 생산 대기열·집결지, 모두의 시대·패배 여부
 * - allies: 팀원의 자원 [[slot, 금, 목재, 마나]] (팀전, 0.5초마다 바뀌었을 때만)
 * - ev: 이벤트. 팀에게만 가는 것(자원 보내기)은 personalize에서 그 팀에게만 얹는다
 *
 * 비어 있는 항목은 키째로 빼고 보낸다. 아무도 움직이지 않는 틱은 { t }만 나간다.
 */
export class SnapshotFeed {
  constructor() {
    this.units = new Map();
    this.buildings = new Map();
    this.mines = new Map();
    this.own = new Map(); // slot → 마지막으로 보낸 own의 JSON
    this.me = new Map(); // slot → 마지막으로 보낸 me의 JSON
    this.allies = new Map(); // slot → 마지막으로 보낸 allies의 JSON
    this.players = ''; // 마지막으로 보낸 공개 플레이어 정보의 JSON
    this.teamEvents = new Map(); // 이번 틱에 팀에게만 가는 이벤트: team → events
  }

  /** 모두가 함께 보는 변화. 부르면 기준선이 이번 틱 상태로 갱신된다. */
  buildDelta(world, events) {
    const addU = [];
    const updU = [];
    const addB = [];
    const updB = [];
    const del = [];
    const mines = [];

    const liveUnits = new Set();
    for (const unit of world.units.values()) {
      liveUnits.add(unit.id);
      const encoded = encodeUnit(unit);
      const previous = this.units.get(unit.id);
      if (!previous) {
        addU.push(encoded);
      } else {
        const delta = diffUnit(previous, encoded);
        if (delta) updU.push(delta);
      }
      this.units.set(unit.id, encoded);
    }
    for (const id of this.units.keys()) {
      if (liveUnits.has(id)) continue;
      this.units.delete(id);
      del.push(id);
    }

    const liveBuildings = new Set();
    for (const building of world.buildings.values()) {
      liveBuildings.add(building.id);
      const encoded = encodeBuilding(building);
      const previous = this.buildings.get(building.id);
      if (!previous) {
        addB.push(encoded);
      } else {
        const delta = diffBuilding(previous, encoded);
        if (delta) updB.push(delta);
      }
      this.buildings.set(building.id, encoded);
    }
    for (const id of this.buildings.keys()) {
      if (liveBuildings.has(id)) continue;
      this.buildings.delete(id);
      del.push(id);
    }

    for (const mine of world.mines.values()) {
      if (this.mines.get(mine.id) === mine.amount) continue;
      this.mines.set(mine.id, mine.amount);
      mines.push([mine.id, mine.amount]);
    }
    for (const id of this.mines.keys()) {
      if (world.mines.has(id)) continue;
      this.mines.delete(id);
      mines.push([id, 0]);
    }

    const delta = { t: world.tick };
    if (addU.length) delta.addU = addU;
    if (updU.length) delta.updU = updU;
    if (addB.length) delta.addB = addB;
    if (updB.length) delta.updB = updB;
    if (del.length) delta.del = del;
    if (mines.length) delta.mines = mines;
    const publicEvents = [];
    this.teamEvents.clear();
    for (const event of events) {
      const team = eventTeam(world, event);
      if (team === null) {
        publicEvents.push(event);
      } else {
        if (!this.teamEvents.has(team)) this.teamEvents.set(team, []);
        this.teamEvents.get(team).push(event);
      }
    }
    if (publicEvents.length) delta.ev = publicEvents;

    const players = publicPlayers(world);
    const json = JSON.stringify(players);
    if (this.players !== json) {
      this.players = json;
      delta.players = players;
    }
    return delta;
  }

  /** 공용 델타에 그 플레이어의 자원·생산 정보·팀 이벤트를 얹는다 (바뀌었을 때만) */
  personalize(delta, world, slot) {
    const snapshot = { ...delta };

    const teamEvents = this.teamEvents.get(world.teamOf(slot));
    if (teamEvents) snapshot.ev = delta.ev ? [...delta.ev, ...teamEvents] : teamEvents;

    if (world.tick % ALLIES_INTERVAL === 0) {
      const allies = encodeAllies(world.players, slot);
      const alliesJson = JSON.stringify(allies);
      if (allies.length && this.allies.get(slot) !== alliesJson) {
        this.allies.set(slot, alliesJson);
        snapshot.allies = allies;
      }
    }

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
    return snapshot;
  }

  /** 처음 들어왔거나 끊겼다 돌아온 플레이어에게 보내는 전체 상태 */
  full(world, slot) {
    // 이미 베인 나무. 델타에서는 TREE_FELLED 이벤트로 알리지만, 전체 상태에는 따로 실어야 한다
    const felled = [];
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.map.tiles[i] === TERRAIN.TREE && world.tiles[i] !== TERRAIN.TREE) felled.push(i);
    }
    const own = encodeOwn(world.buildings.values(), world.units.values(), slot);
    const me = encodePlayer(world.players[slot]);
    const players = publicPlayers(world);
    const allies = encodeAllies(world.players, slot);
    this.own.set(slot, JSON.stringify(own));
    this.me.set(slot, JSON.stringify(me));
    this.allies.set(slot, JSON.stringify(allies));
    this.players = JSON.stringify(players);
    const snapshot = {
      t: world.tick,
      full: true,
      players,
      addU: Array.from(world.units.values(), encodeUnit),
      addB: Array.from(world.buildings.values(), encodeBuilding),
      mines: Array.from(world.mines.values(), (mine) => [mine.id, mine.amount]),
      felled,
      me,
      own,
    };
    if (allies.length) snapshot.allies = allies;
    return snapshot;
  }
}
