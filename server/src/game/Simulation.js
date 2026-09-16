import { TICK_MS } from '@rune/shared/constants.js';
import { applyCommands } from './systems/commands.js';
import { updateMovement } from './systems/movement.js';
import { separateUnits } from './systems/separation.js';
import { updateCombat } from './systems/combat.js';
import { removeDead } from './systems/cleanup.js';
import { updateGathering } from './systems/gathering.js';
import { updateConstruction } from './systems/construction.js';
import { updateProduction } from './systems/production.js';
import { updateEconomy } from './systems/economy.js';
import { updateVictory } from './systems/victory.js';

export const TICK_SECONDS = TICK_MS / 1000;

/**
 * 한 틱을 진행한다. 시스템 순서가 곧 규칙이다 (docs/ARCHITECTURE.md 4장).
 * 이동이 전투보다 먼저라서 사거리 판정은 이번 틱에 움직인 위치로 한다.
 * 네트워크와 타이머에 의존하지 않아 테스트에서 그대로 돌릴 수 있다.
 *
 * @param {import('./World.js').World} world
 * @param {Array<{ slot: number, cmd: object }>} commands 이번 틱에 적용할 명령 (sanitizeCommand를 거친 것)
 * @returns {{ rejects: Array<{ slot: number, seq: number, reason: string }>, events: Array }}
 */
export function stepWorld(world, commands = []) {
  const rejects = [];
  applyCommands(world, commands, rejects);
  updateMovement(world, TICK_SECONDS); // 경로 요청 처리 포함
  separateUnits(world);
  updateCombat(world, TICK_SECONDS);
  removeDead(world);
  updateGathering(world, TICK_SECONDS);
  updateConstruction(world, TICK_SECONDS);
  updateProduction(world, TICK_SECONDS);
  updateEconomy(world, TICK_SECONDS);
  updateVictory(world);
  world.tick += 1;
  return { rejects, events: world.takeEvents() };
}
