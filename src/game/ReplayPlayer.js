import { TICK_MS } from '@rune/shared/constants.js';

export const REPLAY_SPEEDS = Object.freeze([0.5, 1, 2, 4, 8]);

/**
 * 리플레이 재생 로직 (DOM 없이 테스트할 수 있게 화면과 분리했다).
 * 스냅샷은 앞에서부터 차례로 적용해야 하는 델타라서, 뒤로 감을 때는 처음부터 다시 적용한다.
 * 20분 경기(스냅샷 2만 4천 개)를 처음부터 다시 적용해도 수십 ms면 끝난다.
 */
export class ReplayPlayer {
  /**
   * @param {object} replay decodeReplay()로 읽은 리플레이
   * @param {import('../world/ClientWorld.js').ClientWorld} world 비어 있는 클라이언트 월드
   */
  constructor(replay, world) {
    this.replay = replay;
    this.world = world;
    this.snapshots = replay.snapshots;
    this.firstTick = this.snapshots[0].t;
    this.lastTick = this.snapshots[this.snapshots.length - 1].t;
    this.index = 0; // 다음에 적용할 스냅샷
    this.tick = this.firstTick; // 재생 위치 (소수 틱)
    this.playing = true;
    this.speed = 1;
    /** 되감기로 지형을 새로 그려야 할 때 */
    this.onRewind = null;
    this.applyUntil(this.firstTick);
  }

  get durationSec() {
    return ((this.lastTick - this.firstTick) * TICK_MS) / 1000;
  }

  get positionSec() {
    return ((this.tick - this.firstTick) * TICK_MS) / 1000;
  }

  get ended() {
    return this.tick >= this.lastTick;
  }

  /** tick 이하의 스냅샷을 모두 적용한다 */
  applyUntil(tick) {
    const { snapshots, world } = this;
    while (this.index < snapshots.length && snapshots[this.index].t <= tick) {
      world.applySnapshot(snapshots[this.index]);
      this.index++;
    }
  }

  /** 실제 흐른 시간만큼 재생한다 */
  advance(dt) {
    if (!this.playing) return;
    this.tick = Math.min(this.lastTick, this.tick + ((dt * 1000) / TICK_MS) * this.speed);
    this.applyUntil(Math.floor(this.tick));
    if (this.ended) this.playing = false;
  }

  /** 원하는 틱으로 옮긴다. 뒤로 가면 처음부터 다시 적용한다. 탐색 중에는 효과를 만들지 않는다. */
  seek(tick) {
    const target = Math.max(this.firstTick, Math.min(this.lastTick, tick));
    const world = this.world;
    world.quiet = true;
    if (target < world.tick) {
      world.reset();
      this.index = 0;
      this.onRewind?.();
    }
    this.applyUntil(Math.floor(target));
    world.quiet = false;
    world.effects.length = 0;
    this.tick = target;
  }

  seekSeconds(seconds) {
    this.seek(this.firstTick + (seconds * 1000) / TICK_MS);
  }

  togglePlay() {
    if (this.ended) this.seek(this.firstTick); // 끝났으면 처음부터
    this.playing = !this.playing;
  }

  setSpeed(speed) {
    if (REPLAY_SPEEDS.includes(speed)) this.speed = speed;
  }

  /** 그릴 시점: 적용한 스냅샷 사이를 잇도록 한 틱 뒤를 보여 준다 */
  get renderTick() {
    return this.tick - 1;
  }
}
