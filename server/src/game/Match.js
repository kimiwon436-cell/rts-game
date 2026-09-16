import { TICK_MS } from '@rune/shared/constants.js';
import { loadMap } from '@rune/shared/map/maps/index.js';
import { EV, REJECT, VICTORY_REASON } from '@rune/shared/protocol.js';
import { World } from './World.js';
import { stepWorld } from './Simulation.js';
import { sanitizeCommand } from './systems/commands.js';
import { defeatPlayer } from './systems/victory.js';
import { buildSharedFrame, snapshotFor } from './sync/snapshot.js';

const MAX_CATCH_UP = 5;
const MAX_QUEUE = 200;
const RATE_LIMIT = { capacity: 40, refillPerSec: 20 }; // 순간 40개, 초당 20개

/** 경기 한 판. 고정 틱으로 월드를 진행하고 플레이어마다 스냅샷을 보낸다. */
export class Match {
  /**
   * @param {object} p
   * @param {string} p.roomId
   * @param {string} p.mapId
   * @param {Array<{ uid: string, nickname: string, slot: number }>} p.players
   * @param {(uid: string) => import('socket.io').Socket | undefined} p.getSocket
   * @param {(result: object) => void} [p.onEnd] 경기가 끝나면 한 번 불린다
   */
  constructor({ roomId, mapId, players, getSocket, onEnd }) {
    this.roomId = roomId;
    this.getSocket = getSocket;
    this.onEnd = onEnd;
    this.ended = false;
    this.world = new World(loadMap(mapId), players);
    this.slotOfUid = new Map(players.map((p) => [p.uid, p.slot]));
    this.uidOfSlot = new Map(players.map((p) => [p.slot, p.uid]));
    this.buckets = new Map(players.map((p) => [p.uid, { tokens: RATE_LIMIT.capacity, last: Date.now() }]));
    this.queue = [];
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    let next = performance.now();
    const loop = () => {
      if (!this.running) return;
      let steps = 0;
      while (this.running && performance.now() >= next && steps < MAX_CATCH_UP) {
        this.step();
        next += TICK_MS;
        steps++;
      }
      if (steps === MAX_CATCH_UP) next = performance.now(); // 너무 밀리면 따라잡기를 포기한다
      if (!this.running) return;
      this.timer = setTimeout(loop, Math.max(0, next - performance.now()));
      this.timer.unref?.();
    };
    loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** 명령을 다음 틱에 적용하도록 쌓는다. 모양이 틀리거나 너무 많으면 바로 거부한다. */
  enqueue(uid, raw) {
    const slot = this.slotOfUid.get(uid);
    if (slot === undefined) return;
    const cmd = sanitizeCommand(raw);
    if (!cmd) {
      this.sendReject(uid, Number.isInteger(raw?.seq) ? raw.seq : -1, REJECT.INVALID);
      return;
    }
    if (this.queue.length >= MAX_QUEUE || !this.takeToken(uid)) {
      this.sendReject(uid, cmd.seq, REJECT.RATE_LIMITED);
      return;
    }
    this.queue.push({ slot, cmd });
  }

  /** 경기 중에 나간 플레이어는 패배한다. 다음 틱에 결과가 정해진다. (연결이 끊겼을 때의 재접속 유예는 3-5) */
  removePlayer(uid) {
    const slot = this.slotOfUid.get(uid);
    this.slotOfUid.delete(uid);
    if (slot !== undefined && !this.ended) defeatPlayer(this.world, this.world.players[slot], VICTORY_REASON.LEFT);
  }

  step() {
    const commands = this.queue;
    this.queue = [];
    const { rejects, events } = stepWorld(this.world, commands);
    for (const { slot, seq, reason } of rejects) this.sendReject(this.uidOfSlot.get(slot), seq, reason);

    const frame = buildSharedFrame(this.world, events);
    for (const [uid, slot] of this.slotOfUid) {
      this.getSocket(uid)?.emit(EV.GAME_SNAP, snapshotFor(frame, this.world, slot));
    }
    if (this.world.result && !this.ended) this.finish();
  }

  /** 결과를 남은 플레이어에게 보내고 틱을 멈춘다 */
  finish() {
    this.ended = true;
    this.stop();
    const { winner, reason, tick } = this.world.result;
    const result = {
      winner,
      reason,
      durationSec: Math.round((tick * TICK_MS) / 1000),
      players: this.world.players
        .filter(Boolean)
        .map((p) => ({ slot: p.slot, nickname: p.nickname, defeated: p.defeated })),
    };
    for (const uid of this.slotOfUid.keys()) this.getSocket(uid)?.emit(EV.GAME_END, result);
    this.onEnd?.(result);
  }

  sendReject(uid, seq, reason) {
    this.getSocket(uid)?.emit(EV.GAME_REJECT, { seq, reason });
  }

  takeToken(uid) {
    const bucket = this.buckets.get(uid);
    const now = Date.now();
    bucket.tokens = Math.min(RATE_LIMIT.capacity, bucket.tokens + ((now - bucket.last) / 1000) * RATE_LIMIT.refillPerSec);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
