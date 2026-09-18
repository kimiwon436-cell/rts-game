// 소리 엔진 (Web Audio). 브라우저 전용 — 파일 목록은 Vite가 빌드할 때 모은다.
// - 효과음(공격·건물 완성): 처음 쓸 때 내려받아 풀어 둔 버퍼로 낸다. 화면 속 위치에 따라 좌우·크기가 바뀐다
// - 짓는 중 소리: 반복 버퍼. 게임이 "지금 들려야 할 공사 터"를 알려 주면 켜고 끈다 (setLoops)
// - 알람: 한 번에 하나. 더 급한 알람만 나던 알람을 끊는다
// - 배경 음악: <audio>로 흘려 틀고 갈래 볼륨으로 섞는다 (곡이 길어 통째로 풀지 않는다)
// 파일이 없는 소리는 조용히 건너뛴다. 넣는 대로 들린다.
// 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로, 첫 입력에서 unlock()을 부른다.
import { CHANNELS, SOUNDS, soundIdOf } from './soundList.js';
import { readStorage, writeStorage } from '../ui/dom.js';

const FILES = import.meta.glob('../assets/sounds/**/*.{mp3,ogg,wav,m4a}', { eager: true, query: '?url', import: 'default' });

/** 소리 id → 파일 주소들 (여러 판이면 여럿) */
export const SOUND_FILES = (() => {
  const files = new Map();
  for (const [path, url] of Object.entries(FILES)) {
    const id = soundIdOf(path.replace(/^.*\/assets\/sounds\//, ''));
    if (!id || !SOUNDS[id]) continue;
    if (!files.has(id)) files.set(id, []);
    files.get(id).push(url);
  }
  return files;
})();

const STORAGE_KEY = 'rune.sound';
const MAX_VOICES = 28; // 동시에 나는 효과음 최대
const MAX_SAME = 4; // 같은 소리가 동시에 겹치는 최대
const MIN_GAP_MS = 45; // 같은 효과음을 이 간격보다 자주 내지 않는다
const MAX_LOOPS = 2; // 동시에 들리는 공사 소리 최대
const LOOP_FADE_SEC = 0.25;
const MUSIC_FADE_SEC = 1.2;

export const DEFAULT_SETTINGS = Object.freeze({
  muted: false,
  master: 0.8,
  ...Object.fromEntries(Object.entries(CHANNELS).map(([channel, { volume }]) => [channel, volume])),
});

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readStorage(STORAGE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 여러 판 중 하나 (바로 전 것은 되도록 피한다) */
const pick = (list, not) => {
  if (list.length === 1) return list[0];
  const choices = list.filter((item) => item !== not);
  return choices[Math.floor(Math.random() * choices.length)];
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.bus = null;
    this.settings = readSettings();
    this.buffers = new Map(); // url → Promise<AudioBuffer | null>
    this.playing = new Map(); // id → 지금 나는 수
    this.total = 0;
    this.lastAt = new Map(); // id → 마지막으로 낸 시각(ms)
    this.lastUrl = new Map(); // id → 마지막으로 낸 판
    this.alarming = null; // 지금 나는 알람 { stop, priority }
    this.loops = new Map(); // 공사 터 열쇠 → { id, amp, panner, source }
    this.view = null; // 화면에 보이는 영역 (타일) — 효과음의 좌우·크기
    this.musicWanted = null;
    this.music = null; // { state, element, gain }
    this.subscribers = new Set();
    /** 최근에 낸 소리 (확인·디버그용) */
    this.recent = [];
    if (typeof document !== 'undefined') {
      // 다른 탭으로 가면 화면이 멈추니 공사 소리가 끝없이 돌지 않게 끈다 (돌아오면 게임이 다시 켠다)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.setLoops(new Map());
      });
    }
  }

  has(id) {
    return SOUND_FILES.has(id);
  }

  /** 첫 사용자 입력에서 부른다 (그 전에는 브라우저가 소리를 막는다) */
  unlock() {
    if (this.ready) return;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.ctx = new AudioContextClass();
      this.bus = { master: this.ctx.createGain() };
      this.bus.master.connect(this.ctx.destination);
      for (const channel of Object.keys(CHANNELS)) {
        this.bus[channel] = this.ctx.createGain();
        this.bus[channel].connect(this.bus.master);
      }
      this.applySettings();
    }
    this.ctx
      .resume()
      .then(() => this.syncMusic())
      .catch(() => {});
  }

  get ready() {
    return this.ctx?.state === 'running';
  }

  // ---------- 설정 ----------

  /** muted | master | music | alarm | sfx (크기는 0–1). 이 브라우저에 기억한다 */
  set(key, value) {
    this.settings = { ...this.settings, [key]: value };
    writeStorage(STORAGE_KEY, JSON.stringify(this.settings));
    this.applySettings();
    if (key === 'muted' && value) this.setLoops(new Map());
    for (const listener of this.subscribers) listener(this.settings);
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  applySettings() {
    if (!this.bus) return;
    const now = this.ctx.currentTime;
    this.bus.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, now, 0.03);
    for (const channel of Object.keys(CHANNELS)) this.bus[channel].gain.setTargetAtTime(this.settings[channel], now, 0.03);
  }

  // ---------- 위치 ----------

  /** 화면에 보이는 영역 (타일 좌표). 위치가 있는 소리는 이 영역을 기준으로 좌우·크기를 정한다 */
  setView(view) {
    this.view = view;
  }

  /** 위치의 좌우(pan)와 크기. 화면에서 너무 멀면 null (내지 않는다) */
  spatial(x, y) {
    const view = this.view;
    if (!view) return { gain: 1, pan: 0 };
    const halfW = view.w / 2;
    const halfH = view.h / 2;
    const nx = (x - (view.x + halfW)) / halfW;
    const ny = (y - (view.y + halfH)) / halfH;
    const far = Math.max(Math.abs(nx), Math.abs(ny));
    if (far > 1.35) return null;
    return { gain: 1 - 0.45 * Math.min(1, far), pan: Math.max(-1, Math.min(1, nx)) * 0.7 };
  }

  // ---------- 효과음·알람 ----------

  /**
   * 효과음을 한 번 낸다.
   * @param {string} id soundList의 id
   * @param {{ at?: { x: number, y: number }, volume?: number }} [options] at: 소리 난 자리(타일). 없으면 가운데서 온전히 난다
   * @returns {boolean} 내려고 했는지 (파일이 없거나 막혔으면 false)
   */
  play(id, { at = null, volume = 1 } = {}) {
    const def = SOUNDS[id];
    const urls = SOUND_FILES.get(id);
    if (!def || !urls || !this.ready || this.settings.muted) return false;
    const nowMs = performance.now();
    if (nowMs - (this.lastAt.get(id) ?? -Infinity) < MIN_GAP_MS) return false;
    if ((this.playing.get(id) ?? 0) >= MAX_SAME || this.total >= MAX_VOICES) return false;
    let pan = 0;
    let gain = volume;
    if (at) {
      const place = this.spatial(at.x, at.y);
      if (!place) return false;
      pan = place.pan;
      gain *= place.gain;
    }
    this.lastAt.set(id, nowMs);
    this.start(id, this.pickUrl(id, urls), def.channel, { gain, pan });
    return true;
  }

  /**
   * 알람을 낸다. 알람은 한 번에 하나: 더 급한(priority가 큰) 알람만 나던 알람을 끊고 새로 난다.
   * 나던 알람이 같거나 더 급하면 내지 않는다 (false).
   * @param {{ priority?: number, reason?: string }} [options] reason: 무슨 일인지 (확인·디버그용)
   */
  alarm(id, { priority = 1, reason = '' } = {}) {
    const urls = SOUND_FILES.get(id);
    if (!urls || !this.ready || this.settings.muted) return false;
    if (this.alarming && this.alarming.priority >= priority) return false;
    this.alarming?.stop();
    const current = { priority, stop: () => {} };
    const handle = this.start(id, this.pickUrl(id, urls), 'alarm', {
      gain: 1,
      pan: 0,
      onEnd: () => {
        if (this.alarming === current) this.alarming = null;
      },
    });
    current.stop = handle.stop;
    this.alarming = current;
    if (reason) this.recent[this.recent.length - 1].reason = reason;
    return true;
  }

  pickUrl(id, urls) {
    const url = pick(urls, this.lastUrl.get(id));
    this.lastUrl.set(id, url);
    return url;
  }

  /** 버퍼 소리 하나. 파일을 아직 못 받았으면 받는 대로 낸다 */
  start(id, url, channel, { gain, pan, onEnd }) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const amp = ctx.createGain();
    amp.gain.value = gain;
    let tail = amp;
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      amp.connect(panner);
      tail = panner;
    }
    tail.connect(this.bus[channel]);
    source.connect(amp);
    this.playing.set(id, (this.playing.get(id) ?? 0) + 1);
    this.total++;
    this.remember(id);
    let started = false;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.playing.set(id, Math.max(0, (this.playing.get(id) ?? 1) - 1));
      this.total = Math.max(0, this.total - 1);
      tail.disconnect();
      onEnd?.();
    };
    source.onended = finish;
    this.load(url).then((buffer) => {
      if (ended) return; // 받는 사이에 끊겼다
      if (!buffer) {
        finish();
        return;
      }
      source.buffer = buffer;
      try {
        source.start();
        started = true;
      } catch {
        finish();
      }
    });
    const stop = () => {
      if (!started) {
        finish();
        return;
      }
      try {
        source.stop();
      } catch {
        finish();
      }
    };
    return { url, stop };
  }

  remember(id) {
    this.recent.push({ id, at: performance.now() });
    if (this.recent.length > 60) this.recent.shift();
  }

  load(url) {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => this.ctx.decodeAudioData(data))
        .catch((err) => {
          console.warn('[소리] 읽지 못한 파일:', url, err);
          return null;
        });
      this.buffers.set(url, pending);
    }
    return pending;
  }

  /** 미리 내려받아 둔다 (첫 소리가 늦게 나지 않게). 소리를 켜기 전이면 건너뛴다 */
  preload(ids) {
    if (!this.ctx) return;
    for (const id of ids) for (const url of SOUND_FILES.get(id) ?? []) this.load(url);
  }

  // ---------- 짓는 중 소리 (반복) ----------

  /**
   * 지금 들려야 할 반복 소리를 모두 알려 준다: Map(열쇠 → { id, at }).
   * 새로 생긴 것은 서서히 켜고, 빠진 것은 서서히 끄고, 남은 것은 자리에 맞춰 좌우·크기를 고친다.
   * 앞에 있는 것부터 MAX_LOOPS개까지만 낸다 (가까운 순으로 넘긴다).
   */
  setLoops(wanted) {
    if (!this.ctx) return;
    const list = this.ready && !this.settings.muted ? wanted : new Map();
    const t = this.ctx.currentTime;
    for (const [key, loop] of this.loops) {
      const want = list.get(key);
      const place = want?.id === loop.id ? this.spatial(want.at.x, want.at.y) : null;
      if (!place) {
        this.stopLoop(key);
        continue;
      }
      loop.amp.gain.setTargetAtTime(place.gain, t, LOOP_FADE_SEC / 3);
      loop.panner?.pan.setTargetAtTime(place.pan, t, LOOP_FADE_SEC / 3);
    }
    for (const [key, want] of list) {
      if (this.loops.size >= MAX_LOOPS) break;
      if (this.loops.has(key)) continue;
      const urls = SOUND_FILES.get(want.id);
      const place = urls && this.spatial(want.at.x, want.at.y);
      if (place) this.startLoop(key, want.id, pick(urls), place);
    }
  }

  startLoop(key, id, url, place) {
    const ctx = this.ctx;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = place.pan;
      amp.connect(panner);
      panner.connect(this.bus[SOUNDS[id].channel]);
    } else {
      amp.connect(this.bus[SOUNDS[id].channel]);
    }
    const loop = { id, amp, panner, source: null };
    this.loops.set(key, loop);
    this.remember(id);
    this.load(url).then((buffer) => {
      if (!buffer || this.loops.get(key) !== loop) return; // 받는 사이에 꺼졌다
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(amp);
      // 같은 소리를 내는 터가 여럿이어도 박자가 겹치지 않게 아무 데서나 시작한다
      source.start(0, Math.random() * buffer.duration);
      loop.source = source;
      amp.gain.setTargetAtTime(place.gain, ctx.currentTime, LOOP_FADE_SEC / 3);
    });
  }

  stopLoop(key) {
    const loop = this.loops.get(key);
    if (!loop) return;
    this.loops.delete(key);
    loop.amp.gain.setTargetAtTime(0, this.ctx.currentTime, LOOP_FADE_SEC / 3);
    setTimeout(() => {
      try {
        loop.source?.stop();
      } catch {
        // 이미 멈췄다
      }
      loop.amp.disconnect();
      loop.panner?.disconnect();
    }, LOOP_FADE_SEC * 1000 + 150);
  }

  // ---------- 배경 음악 ----------

  /** 'lobby' | 'game' | null (끔) */
  setMusic(state) {
    if (this.musicWanted === state) return;
    this.musicWanted = state;
    this.syncMusic();
  }

  syncMusic() {
    if (!this.ready) return;
    const state = this.musicWanted;
    if (this.music?.state === state) return;
    this.fadeOut(this.music);
    this.music = null;
    const id = `bgm/${state}`;
    const urls = state ? SOUND_FILES.get(id) : null;
    if (!urls) return;
    const repeat = SOUNDS[id].loop;
    const element = new Audio(this.pickUrl(id, urls));
    element.loop = repeat && urls.length === 1; // 여러 곡(_1, _2 …)이면 끝날 때 다른 곡으로 넘어간다
    element.preload = 'auto';
    const source = this.ctx.createMediaElementSource(element);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.bus.music);
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, MUSIC_FADE_SEC / 3);
    element.play().catch(() => {});
    const track = { state, element, gain };
    this.music = track;
    this.remember(id);
    element.addEventListener('ended', () => {
      if (this.music !== track || !repeat) return;
      this.music = null;
      track.gain.disconnect();
      this.syncMusic();
    });
  }

  fadeOut(track) {
    if (!track) return;
    track.gain.gain.setTargetAtTime(0, this.ctx.currentTime, MUSIC_FADE_SEC / 3);
    setTimeout(() => {
      track.element.pause();
      track.gain.disconnect();
    }, MUSIC_FADE_SEC * 1000 + 200);
  }
}

/** 게임 전체가 함께 쓰는 소리 엔진 하나 */
export const sound = new SoundEngine();
