import { TICK_MS } from '@rune/shared/constants.js';
import { REVEAL_SECONDS, REVEAL_SIGHT, sightOf } from '@rune/shared/rules/vision.js';

const REVEAL_TICKS = Math.round((REVEAL_SECONDS * 1000) / TICK_MS);

/**
 * 전장의 안개: 팀마다 무엇이 보이는지 갱신한다. 틱 맨 앞에서 돌아 이번 틱의 명령 검증·표적 찾기·스냅샷이
 * 모두 같은 시야를 쓴다. (한 틱 사이 움직임은 0.2타일 남짓이라 틱 중간에 다시 계산하지 않는다)
 *
 * - 유닛은 제 위치에서, 건물은 풋프린트 중심에서 시야를 편다. 짓는 중인 건물은 좁게 본다
 * - 등에 탄 유닛은 따로 보지 않는다 (태운 아르카논의 시야를 쓴다)
 * - 공격한 유닛·건물은 맞은 팀에게 잠깐 드러난다 (revealAttacker)
 * - 한 번 본 적 건물은 기억한다: 안개 속에 있어도 공격 명령을 내릴 수 있다
 */
export function updateVision(world) {
  const { vision } = world;
  vision.begin();
  for (const unit of world.units.values()) {
    if (!unit.carrierId) vision.place(unit.id, world.teamOf(unit.owner), unit.x, unit.y, sightOf(unit.type));
    if (unit.revealUntil) placeReveals(world, unit, unit.x, unit.y);
  }
  for (const building of world.buildings.values()) {
    const cx = building.x + building.w / 2;
    const cy = building.y + building.h / 2;
    vision.place(building.id, world.teamOf(building.owner), cx, cy, sightOf(building.type, building.complete));
    if (building.revealUntil) placeReveals(world, building, cx, cy);
  }
  vision.end();

  for (const building of world.buildings.values()) {
    const owner = world.teamOf(building.owner);
    for (let team = 0; team < world.knownBuildings.length; team++) {
      if (team === owner || world.knownBuildings[team].has(building.id)) continue;
      if (vision.isRectVisible(team, building)) world.knownBuildings[team].add(building.id);
    }
  }
}

/** 공격자를 맞은 쪽 팀에게 잠깐 드러낸다 */
export function revealAttacker(world, attacker, target) {
  const team = world.teamOf(target.owner);
  if (team === world.teamOf(attacker.owner)) return;
  attacker.revealUntil ??= [];
  attacker.revealUntil[team] = world.tick + REVEAL_TICKS;
}

function placeReveals(world, entity, x, y) {
  let active = false;
  entity.revealUntil.forEach((until, team) => {
    if (!(until > world.tick)) return;
    active = true;
    world.vision.place(-(entity.id * 8 + team + 1), team, x, y, REVEAL_SIGHT); // 유닛 시야와 겹치지 않는 음수 key
  });
  if (!active) entity.revealUntil = null;
}
