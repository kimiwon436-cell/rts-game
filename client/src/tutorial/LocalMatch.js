import { TICK_MS } from '@rune/shared/constants.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { EV } from '@rune/shared/protocol.js';
import { World } from '../../../server/src/game/World.js';
import { stepWorld } from '../../../server/src/game/Simulation.js';
import { SnapshotFeed } from '../../../server/src/game/sync/snapshot.js';
import { sanitizeCommand } from '../../../server/src/game/systems/commands.js';

/**
 * 서버 없이 브라우저 안에서 도는 경기 (튜토리얼·연습용).
 * 게임 서버와 똑같은 시뮬레이션을 돌리고, 소켓 흉내를 내서 GameView를 고치지 않고 그대로 쓴다.
 * - emit('game:cmd') → 다음 틱에 명령 적용
 * - on('game:snap' | 'game:reject' | 'game:end') ← 틱마다
 */
export class LocalMatch {
  constructor({ mapId, players, mySlot = 0 }) {
    this.mapId = mapId;
    this.mySlot = mySlot;
    this.world = new World(loadMap(mapId), players);
    this.feed = new SnapshotFeed();
    this.handlers = new Map();
    this.queue = [];
    this.seq = 0;
    this.speed = 1; // 기다리는 단계에서는 빨리 돌린다
    this.timer = null;
    this.first = true;
    this.tickListeners = new Set();
    this.connected = true; // 소켓 흉내
  }

  // ---------- 소켓 흉내 ----------

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event, payload) {
    if (event !== EV.GAME_CMD) return;
    const cmd = sanitizeCommand(payload);
    if (cmd) this.queue.push({ slot: this.mySlot, cmd });
  }

  dispatch(event, payload) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  // ---------- 진행 ----------

  /** 다른 슬롯(튜토리얼의 적)에게 명령한다 */
  command(slot, cmd) {
    this.queue.push({ slot, cmd: { seq: ++this.seq, unitIds: [], ...cmd } });
  }

  /** 틱마다 불린다: (events) — 단계 완료를 확인하는 데 쓴다 */
  onTick(listener) {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  step() {
    const commands = this.queue;
    this.queue = [];
    const { rejects, events } = stepWorld(this.world, commands);
    for (const reject of rejects) if (reject.slot === this.mySlot) this.dispatch(EV.GAME_REJECT, reject);

    const snap = this.first
      ? this.feed.full(this.world, this.mySlot)
      : this.feed.personalize(this.feed.buildDelta(this.world, events), this.world, this.mySlot);
    this.first = false;
    this.dispatch(EV.GAME_SNAP, snap);
    for (const listener of this.tickListeners) listener(events);
  }

  start() {
    if (this.timer) return;
    // 50ms마다 speed틱을 돈다 (4배속이면 한 번에 4틱)
    this.timer = setInterval(() => {
      for (let i = 0; i < this.speed; i++) this.step();
    }, TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
