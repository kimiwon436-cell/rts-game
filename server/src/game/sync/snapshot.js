import { encodeBuilding, encodeOwn, encodePlayer, encodePublicPlayer, encodeUnit } from '@rune/shared/snapshot.js';

/** 이번 틱에 모든 플레이어가 함께 보는 부분. 틱마다 한 번만 만든다. */
export function buildSharedFrame(world, events) {
  return {
    t: world.tick,
    players: world.players.filter(Boolean).map((p) => encodePublicPlayer(p, world.tick)),
    units: Array.from(world.units.values(), encodeUnit),
    buildings: Array.from(world.buildings.values(), encodeBuilding),
    mines: Array.from(world.mines.values(), (m) => [m.id, m.amount]),
    ev: events,
  };
}

/** 플레이어별 스냅샷: 공유 부분 + 내 자원 + 내 건물의 생산 대기열·집결지 (상대 것은 보내지 않는다) */
export function snapshotFor(frame, world, slot) {
  return {
    ...frame,
    me: encodePlayer(world.players[slot]),
    own: encodeOwn(world.buildings.values(), slot),
  };
}
