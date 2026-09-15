import { TICK_MS } from '@rune/shared/constants.js';
import { applyCommands } from './systems/commands.js';
import { updateMovement } from './systems/movement.js';
import { updateGathering } from './systems/gathering.js';
import { updateConstruction } from './systems/construction.js';
import { updateEconomy } from './systems/economy.js';

export const TICK_SECONDS = TICK_MS / 1000;

/**
 * 한 틱을 진행한다. 시스템 순서가 곧 규칙이다 (docs/ARCHITECTURE.md 4장).
 * 네트워크와 타이머에 의존하지 않아 테스트에서 그대로 돌릴 수 있다.
 *
 * @param {import('./World.js').World} world
 * @param {Array<{ slot: number, cmd: object }>} commands 이번 틱에 적용할 명령 (sanitizeCommand를 거친 것)
 * @returns {{ rejects: Array<{ slot: number, seq: number, reason: string }>, events: Array }}
 */
export function stepWorld(world, commands = []) {
  const rejects = [];
  applyCommands(world, commands, rejects);
  updateMovement(world, TICK_SECONDS);
  updateGathering(world, TICK_SECONDS);
  updateConstruction(world, TICK_SECONDS);
  updateEconomy(world, TICK_SECONDS);
  world.tick += 1;
  return { rejects, events: world.takeEvents() };
}
