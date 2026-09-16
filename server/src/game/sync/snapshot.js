import {
  diffBuilding,
  diffUnit,
  encodeBuilding,
  encodeOwn,
  encodePlayer,
  encodePublicPlayer,
  encodeUnit,
} from '@rune/shared/snapshot.js';

const publicPlayers = (world) => world.players.filter(Boolean).map((p) => encodePublicPlayer(p, world.tick));

/**
 * 틱마다 바뀐 것만 보내기 위해 지난번에 보낸 인코딩을 들고 있다가 비교한다.
 * (엔티티마다 dirty 비트를 다는 대신 인코딩을 비교한다 — 시스템 코드가 단순해지고 결과는 같다)
 *
 * 스냅샷 모양: { t, full?, players?, addU?, updU?, addB?, updB?, del?, mines?, ev?, me?, own? }
 * - addU/addB: 새로 생긴 유닛·건물 (전체 인코딩)
 * - updU/updB: [id, 마스크, ...바뀐 값]
 * - del: 사라진 유닛·건물 id
 * - mines: 양이 바뀐 금광 [id, 남은 양] (0이면 다 캤다는 뜻)
 * - me/own/players: 내 자원, 내 건물의 생산 대기열·집결지, 모두의 시대·패배 여부
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
    this.players = ''; // 마지막으로 보낸 공개 플레이어 정보의 JSON
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
    if (events.length) delta.ev = events;

    const players = publicPlayers(world);
    const json = JSON.stringify(players);
    if (this.players !== json) {
      this.players = json;
      delta.players = players;
    }
    return delta;
  }

  /** 공용 델타에 그 플레이어의 자원과 생산 정보를 얹는다 (둘 다 바뀌었을 때만) */
  personalize(delta, world, slot) {
    const snapshot = { ...delta };

    const me = encodePlayer(world.players[slot]);
    const meJson = JSON.stringify(me);
    if (this.me.get(slot) !== meJson) {
      this.me.set(slot, meJson);
      snapshot.me = me;
    }

    const own = encodeOwn(world.buildings.values(), slot);
    const ownJson = JSON.stringify(own);
    if (this.own.get(slot) !== ownJson) {
      this.own.set(slot, ownJson);
      snapshot.own = own;
    }
    return snapshot;
  }

  /** 처음 들어왔거나 끊겼다 돌아온 플레이어에게 보내는 전체 상태 */
  full(world, slot) {
    const own = encodeOwn(world.buildings.values(), slot);
    const me = encodePlayer(world.players[slot]);
    const players = publicPlayers(world);
    this.own.set(slot, JSON.stringify(own));
    this.me.set(slot, JSON.stringify(me));
    this.players = JSON.stringify(players);
    return {
      t: world.tick,
      full: true,
      players,
      addU: Array.from(world.units.values(), encodeUnit),
      addB: Array.from(world.buildings.values(), encodeBuilding),
      mines: Array.from(world.mines.values(), (mine) => [mine.id, mine.amount]),
      me,
      own,
    };
  }
}
