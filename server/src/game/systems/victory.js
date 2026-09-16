import { TICK_MS } from '@rune/shared/constants.js';
import { GAME_EVENT, VICTORY_REASON } from '@rune/shared/protocol.js';

export const COLLAPSE_SECONDS = 120;
const COLLAPSE_TICKS = Math.round((COLLAPSE_SECONDS * 1000) / TICK_MS);

/**
 * 플레이어를 패배 처리한다. 항복·이탈에도 쓴다.
 * 팀전에서 진 플레이어의 유닛과 건물은 무너진다 — 남은 팀원이 주인 없는 기지를 지키거나
 * 상대가 빈 기지를 부수느라 시간을 쓰지 않게 한다. (1대1은 어차피 이 순간 경기가 끝난다)
 */
export function defeatPlayer(world, player, reason) {
  if (player.defeated) return;
  player.defeated = true;
  player.defeatReason = reason;
  player.collapseAt = null;
  player.revive = null;
  world.lastDefeatReason = reason;
  world.events.push([GAME_EVENT.PLAYER_DEFEATED, player.slot]);
  for (const unit of world.units.values()) if (unit.owner === player.slot) unit.hp = 0;
  for (const building of world.buildings.values()) if (building.owner === player.slot) building.hp = 0;
}

/**
 * 정복 승리 판정 (docs/GAME_DESIGN.md 6장)
 * - 완성된 영주관이 하나도 없으면 '왕관 몰락' 120초 카운트다운. 그 안에 영주관을 다시 완공하면 취소된다
 * - 카운트다운이 끝나거나, 유닛도 건물도 하나 남지 않으면 그 플레이어가 패배
 * - 한 팀의 플레이어가 모두 패배하면 남은 팀이 이긴다 (1대1은 팀원이 한 명씩인 팀전)
 */
export function updateVictory(world) {
  if (world.result) return;

  const holdings = new Map();
  for (const player of world.players) if (player) holdings.set(player.slot, { keep: false, anything: false });
  for (const unit of world.units.values()) holdings.get(unit.owner).anything = true;
  for (const building of world.buildings.values()) {
    const holding = holdings.get(building.owner);
    holding.anything = true;
    if (building.type === 'keep' && building.complete) holding.keep = true;
  }

  for (const player of world.players) {
    if (!player || player.defeated) continue;
    const { keep, anything } = holdings.get(player.slot);
    if (!anything) {
      defeatPlayer(world, player, VICTORY_REASON.ANNIHILATION);
    } else if (keep) {
      if (player.collapseAt != null) {
        player.collapseAt = null;
        world.events.push([GAME_EVENT.CROWN_RESTORED, player.slot]);
      }
    } else if (player.collapseAt == null) {
      player.collapseAt = world.tick + COLLAPSE_TICKS;
      world.events.push([GAME_EVENT.CROWN_FALLING, player.slot]);
    } else if (world.tick >= player.collapseAt) {
      defeatPlayer(world, player, VICTORY_REASON.CONQUEST);
    }
  }

  const players = world.players.filter(Boolean);
  const teams = new Set(players.map((p) => p.team));
  const standingTeams = new Set(players.filter((p) => !p.defeated).map((p) => p.team));
  if (teams.size >= 2 && standingTeams.size <= 1) {
    world.result = {
      winnerTeam: standingTeams.size ? [...standingTeams][0] : null,
      reason: world.lastDefeatReason,
      tick: world.tick,
    };
  }
}
